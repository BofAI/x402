/**
 * Framework-agnostic core for x402 server middleware.
 *
 * Implements the verify → settle → header-attach pipeline used by all
 * server adapters (Hono, Express, Fastify, ...). Adapters read the request
 * headers, hand them to {@link processX402Request}, then translate the
 * resulting {@link X402Decision} back into their framework's response shape.
 *
 * This mirrors `bankofai.x402.fastapi.X402Middleware` on the Python side but
 * splits the framework binding from the protocol logic so we can target any
 * Node.js HTTP framework with a thin adapter.
 */

import type { FacilitatorClient } from '../facilitator/client.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '../http/client.js';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '../types/index.js';
import {
  decodePaymentPayload,
  encodePaymentPayload,
  generatePaymentId,
} from '../utils/encoding.js';

// Re-export header constants from http/client (single source of truth).
export {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
};

export const X402_VERSION = 2;

/** Minimum config needed to protect an endpoint. */
export interface X402MiddlewareConfig {
  /** Facilitator client used for `/verify` and `/settle`. */
  facilitator: FacilitatorClient;
  /**
   * `accepts` array advertised in the 402 challenge. Multiple entries express
   * multi-token / multi-scheme acceptance — clients pick one and pay it.
   */
  accepts: PaymentRequirements[];
  /** Optional resource info echoed back in the 402 body. */
  resource?: PaymentRequired['resource'];
  /**
   * Optional extensions advertised on the 402 (e.g. `payment-identifier`).
   * Forwarded as-is into the `PaymentRequired.extensions` field. When
   * `enrich` is true (default), `paymentPermitContext` is generated per
   * request and merged into this object.
   */
  extensions?: PaymentRequired['extensions'];
  /**
   * When true (default), the middleware enriches the 402 challenge per-request:
   * - calls `facilitator.feeQuote()` for permit-style accepts and attaches
   *   the result to `accept.extra.fee`
   * - generates fresh `paymentPermitContext` (paymentId/nonce/validAfter/validBefore)
   *
   * Set `false` to keep the legacy passthrough behavior — useful when the
   * caller has already enriched the requirements via {@link X402Server}.
   */
  enrich?: boolean;
}

/** Outcome of {@link processX402Request}. The adapter renders this. */
export type X402Decision =
  /** No payment header → return a 402 with PAYMENT-REQUIRED set. */
  | {
      kind: 'paymentRequired';
      status: 402;
      paymentRequired: PaymentRequired;
      headers: Record<string, string>;
    }
  /** Payload was malformed or doesn't match any acceptable requirement. */
  | {
      kind: 'invalid';
      status: 400;
      reason: string;
    }
  /** Verify or settle failed → tell the client. */
  | {
      kind: 'failed';
      status: 500;
      reason: string;
      transaction?: string;
      network?: string;
    }
  /**
   * Payment succeeded. Adapter should run the protected handler and attach
   * `headers` (which contains `PAYMENT-RESPONSE`) onto the response.
   */
  | {
      kind: 'allow';
      settleResult: SettleResponse;
      headers: Record<string, string>;
    };

/**
 * Run one x402 protocol iteration against the given config.
 *
 * @param signatureHeader - Value of the `PAYMENT-SIGNATURE` request header (or
 *   null/undefined if absent).
 * @param config - Server-side payment configuration.
 */
export async function processX402Request(
  signatureHeader: string | null | undefined,
  config: X402MiddlewareConfig,
): Promise<X402Decision> {
  if (!signatureHeader) {
    const paymentRequired = await buildPaymentRequired(config);
    return {
      kind: 'paymentRequired',
      status: 402,
      paymentRequired,
      headers: {
        [PAYMENT_REQUIRED_HEADER]: encodePaymentPayload(paymentRequired),
      },
    };
  }

  let payload: PaymentPayload;
  try {
    payload = decodePaymentPayload<PaymentPayload>(signatureHeader);
  } catch (err) {
    return {
      kind: 'invalid',
      status: 400,
      reason: `Invalid payment payload: ${(err as Error).message}`,
    };
  }

  const matched = matchAccepts(config.accepts, payload);
  if (!matched) {
    return {
      kind: 'invalid',
      status: 400,
      reason: 'Unsupported payment token / network / scheme',
    };
  }

  let verifyResult;
  try {
    verifyResult = await config.facilitator.verify(payload, matched);
  } catch (err) {
    return {
      kind: 'failed',
      status: 500,
      reason: `Verify request failed: ${(err as Error).message}`,
    };
  }
  if (!verifyResult.isValid) {
    return {
      kind: 'failed',
      status: 500,
      reason: verifyResult.invalidReason ?? 'verify rejected payment',
    };
  }

  let settleResult: SettleResponse;
  try {
    settleResult = await config.facilitator.settle(payload, matched);
  } catch (err) {
    return {
      kind: 'failed',
      status: 500,
      reason: `Settle request failed: ${(err as Error).message}`,
    };
  }
  if (!settleResult.success) {
    return {
      kind: 'failed',
      status: 500,
      reason: settleResult.errorReason ?? 'settle failed',
      transaction: settleResult.transaction,
      network: settleResult.network,
    };
  }

  return {
    kind: 'allow',
    settleResult,
    headers: {
      [PAYMENT_RESPONSE_HEADER]: encodePaymentPayload(settleResult),
    },
  };
}

/**
 * Build the 402 challenge body. When `enrich: true`, fetches `feeQuote` from
 * the facilitator for permit-style accepts and generates a fresh
 * `paymentPermitContext` (paymentId/nonce/validAfter/validBefore) per request.
 *
 * Mirrors Python `X402Server.create_payment_required_response`.
 */
async function buildPaymentRequired(
  config: X402MiddlewareConfig,
): Promise<PaymentRequired> {
  let accepts = config.accepts;
  let extensions = config.extensions;

  if (config.enrich !== false) {
    // Enrich accepts with extra.fee for permit-style schemes
    const permitReqs = config.accepts.filter((a) => a.scheme !== 'exact');
    if (permitReqs.length > 0) {
      try {
        const quotes = await config.facilitator.feeQuote(permitReqs);
        const quoteMap = new Map<string, (typeof quotes)[number]>();
        for (const q of quotes) {
          quoteMap.set(`${q.scheme}|${q.network}|${q.asset}`, q);
        }
        accepts = config.accepts
          .map((a) => {
            if (a.scheme === 'exact') return a;
            const quote = quoteMap.get(`${a.scheme}|${a.network}|${a.asset}`);
            if (!quote) return null;
            return {
              ...a,
              extra: {
                ...(a.extra ?? {}),
                fee: {
                  ...quote.fee,
                  facilitatorId: config.facilitator.facilitatorId,
                },
              },
            };
          })
          .filter((a): a is PaymentRequirements => a !== null);
      } catch {
        // If feeQuote fails, fall through with un-enriched accepts. Facilitator
        // may still accept the request, or signal at verify time.
      }
    }

    // Generate fresh paymentPermitContext per challenge
    const now = Math.floor(Date.now() / 1000);
    const validAfter = now;
    const validBefore = now + 3600;
    extensions = {
      ...(extensions ?? {}),
      paymentPermitContext: {
        meta: {
          kind: 'PAYMENT_ONLY',
          paymentId: generatePaymentId(),
          nonce: generateNonce(),
          validAfter,
          validBefore,
        },
      },
    } as PaymentRequired['extensions'];
  }

  return {
    x402Version: X402_VERSION,
    accepts,
    ...(config.resource ? { resource: config.resource } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

function generateNonce(): string {
  // 16 random bytes, decimal-encoded — matches Python's `str(uuid.uuid4().int)`.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let nonce = 0n;
  for (const byte of bytes) {
    nonce = (nonce << 8n) | BigInt(byte);
  }
  return nonce.toString();
}

/**
 * Pick the `accepts[]` entry that matches the client's chosen payment.
 *
 * The wire format requires the client to echo `payload.accepted` — we trust
 * that as the discriminator and verify it lines up with our offer.
 */
function matchAccepts(
  accepts: PaymentRequirements[],
  payload: PaymentPayload,
): PaymentRequirements | null {
  const want = payload.accepted;
  for (const offer of accepts) {
    if (offer.network !== want.network) continue;
    if (offer.scheme !== want.scheme) continue;
    if (offer.asset.toLowerCase() !== want.asset.toLowerCase()) continue;
    if (offer.payTo.toLowerCase() !== want.payTo.toLowerCase()) continue;
    return offer;
  }
  return null;
}
