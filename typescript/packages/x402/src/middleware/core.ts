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
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '../types/index.js';
import {
  decodePaymentPayload,
  encodePaymentPayload,
} from '../utils/encoding.js';

/** Header names — match the x402 spec exactly (case-insensitive on the wire). */
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

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
   * Forwarded as-is into the `PaymentRequired.extensions` field.
   */
  extensions?: PaymentRequired['extensions'];
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
    const paymentRequired = buildPaymentRequired(config);
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

/** Build the 402 challenge body from the middleware config. */
function buildPaymentRequired(config: X402MiddlewareConfig): PaymentRequired {
  return {
    x402Version: X402_VERSION,
    accepts: config.accepts,
    ...(config.resource ? { resource: config.resource } : {}),
    ...(config.extensions ? { extensions: config.extensions } : {}),
  };
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
