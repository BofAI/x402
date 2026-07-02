/**
 * X402Server — TypeScript port of `bankofai.x402.server.X402Server`.
 *
 * High-level server orchestration:
 * - Registry of {@link ServerMechanism}s keyed by `(network, scheme)`
 * - Build {@link PaymentRequirements} from {@link ResourceConfig} via `parsePrice`
 *   + optional facilitator `feeQuote` enrichment for permit-style schemes
 * - Anti-tamper validation of incoming `PaymentPayload` against server's
 *   original requirements
 * - Delegates `/verify` and `/settle` to a {@link FacilitatorClient}
 *
 * This sits **above** the framework-agnostic {@link processX402Request} core
 * (see `src/middleware/core.ts`). Framework middleware (Hono / Express)
 * can be wired against either:
 * - Raw `accepts[]` + `FacilitatorClient` (lower-level, `processX402Request`)
 * - `X402Server` + `ResourceConfig[]` (higher-level, this file)
 */

import { getAddress, isAddress } from 'viem';

import type { FacilitatorClient } from '../facilitator/client.js';
import { parsePrice } from '../tokens.js';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import { generatePaymentId } from '../utils/index.js';
import { PAYMENT_ONLY, type ResourceConfig, type ServerMechanism } from './types.js';

/** Resource info echoed back in the 402 response body. */
export interface ResourceInfo {
  url?: string;
  description?: string;
  mimeType?: string;
}

/** Optional overrides when building the 402 response. */
export interface BuildPaymentRequiredOptions {
  resource?: ResourceInfo;
  paymentId?: string;
  nonce?: string;
  validAfter?: number;
  validBefore?: number;
}

/**
 * Default {@link ServerMechanism} that delegates `parsePrice` to the token
 * registry and applies a no-op `enhancePaymentRequirements`. Useful when a
 * chain/scheme needs no scheme-specific enrichment.
 */
export class DefaultServerMechanism implements ServerMechanism {
  constructor(private readonly schemeName: string) {}

  scheme(): string {
    return this.schemeName;
  }

  async parsePrice(price: string, network: string) {
    return parsePrice(price, network);
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _deliveryMode: string,
  ): Promise<PaymentRequirements> {
    return requirements;
  }

  validatePaymentRequirements(_requirements: PaymentRequirements): boolean {
    return true;
  }
}

/**
 * Core server orchestration. One instance per resource server.
 *
 * @example
 * ```ts
 * const facilitator = new FacilitatorClient({ baseUrl: 'https://fac.example' });
 * const server = new X402Server()
 *   .register('tron:nile', new DefaultServerMechanism('exact_permit'))
 *   .setFacilitator(facilitator);
 *
 * const accepts = await server.buildPaymentRequirements([
 *   { scheme: 'exact_permit', network: 'tron:nile', price: '1 USDT', payTo: 'T...' },
 * ]);
 * const challenge = server.createPaymentRequiredResponse(accepts);
 * ```
 */
export class X402Server {
  /** network → scheme → mechanism */
  private readonly mechanisms = new Map<string, Map<string, ServerMechanism>>();
  private facilitator: FacilitatorClient | null = null;

  /** Register a {@link ServerMechanism} for one network. Chainable. */
  register(network: string, mechanism: ServerMechanism): this {
    const scheme = mechanism.scheme();
    let byScheme = this.mechanisms.get(network);
    if (!byScheme) {
      byScheme = new Map<string, ServerMechanism>();
      this.mechanisms.set(network, byScheme);
    }
    byScheme.set(scheme, mechanism);
    return this;
  }

  /** Set the facilitator client. Required before {@link verifyPayment} / {@link settlePayment}. */
  setFacilitator(client: FacilitatorClient): this {
    this.facilitator = client;
    return this;
  }

  /**
   * Turn a list of {@link ResourceConfig} into ready-to-serve {@link PaymentRequirements}.
   *
   * Pipeline per config:
   * 1. Find mechanism by `(network, scheme)`; throw if not registered.
   * 2. Parse `price` → asset + amount via mechanism.
   * 3. Build initial `PaymentRequirements`.
   * 4. Let mechanism `enhancePaymentRequirements` attach extras (token name/version, etc.).
   * 5. Normalize EVM addresses via checksum.
   *
   * If a facilitator is configured, permit-style requirements (`scheme !== 'exact'`)
   * get enriched with `extra.fee` from `/fee/quote`. Unsupported (network, scheme, asset)
   * tuples returned by the facilitator are silently dropped from the result.
   *
   * Mirrors Python `X402Server.build_payment_requirements`.
   */
  async buildPaymentRequirements(
    configs: ResourceConfig[],
  ): Promise<PaymentRequirements[]> {
    const built: PaymentRequirements[] = [];
    for (const config of configs) {
      const mechanism = this.findMechanism(config.network, config.scheme);
      if (!mechanism) {
        throw new Error(
          `No ServerMechanism registered for network=${config.network}, scheme=${config.scheme}`,
        );
      }

      const assetInfo = await mechanism.parsePrice(config.price, config.network);

      let requirements: PaymentRequirements = {
        scheme: config.scheme,
        network: config.network,
        amount: assetInfo.amount,
        asset: assetInfo.asset,
        payTo: config.payTo,
        maxTimeoutSeconds: config.validFor ?? 3600,
      };
      requirements = await mechanism.enhancePaymentRequirements(
        requirements,
        config.deliveryMode ?? PAYMENT_ONLY,
      );
      requirements = this.normalizeEvmRequirements(requirements);
      built.push(requirements);
    }

    if (!this.facilitator) {
      throw new Error('Facilitator is not set (call setFacilitator first)');
    }

    // Split: exact doesn't need fee quote; everything else (permit-style) does.
    const exactReqs = built.filter((r) => r.scheme === 'exact');
    const permitReqs = built.filter((r) => r.scheme !== 'exact');

    const supported: PaymentRequirements[] = [...exactReqs];
    if (permitReqs.length > 0) {
      const quotes = await this.facilitator.feeQuote(permitReqs);
      const quoteMap = new Map<string, (typeof quotes)[number]>();
      for (const q of quotes) {
        quoteMap.set(`${q.scheme}|${q.network}|${q.asset}`, q);
      }
      for (const req of permitReqs) {
        const quote = quoteMap.get(`${req.scheme}|${req.network}|${req.asset}`);
        if (!quote) {
          // Facilitator can't quote this (unsupported token / scheme). Silently skip.
          continue;
        }
        const enriched: PaymentRequirements = {
          ...req,
          extra: {
            ...(req.extra ?? {}),
            fee: {
              ...quote.fee,
              facilitatorId: this.facilitator.facilitatorId,
            },
          },
        };
        supported.push(this.normalizeEvmRequirements(enriched));
      }
    }
    return supported;
  }

  /**
   * Build the 402 PaymentRequired challenge body. The facilitator is not
   * consulted here — the caller has already obtained `requirements` via
   * {@link buildPaymentRequirements} or constructed them by hand.
   */
  createPaymentRequiredResponse(
    requirements: PaymentRequirements[],
    options: BuildPaymentRequiredOptions = {},
  ): PaymentRequired {
    const now = Math.floor(Date.now() / 1000);
    const validBefore = options.validBefore ?? now + 3600;
    const validAfter = options.validAfter ?? now;

    return {
      x402Version: 2,
      error: 'Payment required',
      ...(options.resource ? { resource: options.resource } : {}),
      accepts: requirements,
      extensions: {
        paymentPermitContext: {
          meta: {
            kind: PAYMENT_ONLY,
            paymentId: options.paymentId ?? generatePaymentId(),
            nonce: options.nonce ?? generateNonce(),
            validAfter,
            validBefore,
          },
        },
      },
    } as PaymentRequired;
  }

  /**
   * Anti-tamper validation + optional server-side signature check, then
   * delegate to the facilitator. Mirrors Python `verify_payment`.
   */
  async verifyPayment(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    if (!this.validatePayloadMatchesRequirements(payload, requirements)) {
      return { isValid: false, invalidReason: 'payload_mismatch' };
    }

    const mechanism = this.findMechanism(requirements.network, requirements.scheme);
    if (mechanism?.verifySignature) {
      const permit = payload.payload.paymentPermit ?? null;
      const signature = payload.payload.signature;
      const ok = await mechanism.verifySignature(permit, signature, requirements.network);
      if (!ok) {
        return { isValid: false, invalidReason: 'invalid_signature_server' };
      }
    }

    if (!this.facilitator) {
      return { isValid: false, invalidReason: 'no_facilitator' };
    }
    return this.facilitator.verify(payload, requirements);
  }

  /** Delegate settlement to the facilitator. Mirrors Python `settle_payment`. */
  async settlePayment(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    if (!this.facilitator) {
      return {
        success: false,
        network: requirements.network,
        errorReason: 'no_facilitator',
      };
    }
    return this.facilitator.settle(payload, requirements);
  }

  /**
   * Anti-tampering: the client's `payload.accepted` must match server's
   * canonical `requirements`, and the embedded authorization / permit must
   * point at the right asset / payTo / amount.
   *
   * Two flavors:
   * - `exact` (ERC-3009): inspects `payload.payload.authorization`
   * - other (permit-style): inspects `payload.payload.paymentPermit`
   */
  private validatePayloadMatchesRequirements(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): boolean {
    if (requirements.scheme === 'exact') {
      const auth =
        payload.payload.authorization ??
        ((payload.extensions ?? {})['transferAuthorization'] as
          | PaymentPayload['payload']['authorization']
          | undefined);
      if (!auth) return false;

      if (payload.accepted) {
        if (payload.accepted.asset !== requirements.asset) return false;
        if (payload.accepted.network !== requirements.network) return false;
      }

      try {
        if (BigInt(String(auth.value)) < BigInt(requirements.amount)) return false;
      } catch {
        return false;
      }
      if (String(auth.to).toLowerCase() !== String(requirements.payTo).toLowerCase()) {
        return false;
      }

      const now = Math.floor(Date.now() / 1000);
      try {
        const validBefore = BigInt(String(auth.validBefore ?? '0'));
        const validAfter = BigInt(String(auth.validAfter ?? now));
        if (validBefore < BigInt(now)) return false;
        if (validAfter > BigInt(now)) return false;
      } catch {
        return false;
      }
      return true;
    }

    const permit = payload.payload.paymentPermit;
    if (!permit) return false;
    if (permit.payment.payToken !== requirements.asset) return false;
    if (permit.payment.payTo !== requirements.payTo) return false;
    try {
      if (BigInt(permit.payment.payAmount) < BigInt(requirements.amount)) return false;
    } catch {
      return false;
    }
    return true;
  }

  private findMechanism(network: string, scheme: string): ServerMechanism | null {
    return this.mechanisms.get(network)?.get(scheme) ?? null;
  }

  private normalizeEvmRequirements(reqs: PaymentRequirements): PaymentRequirements {
    if (!reqs.network.startsWith('eip155:')) {
      return reqs;
    }
    return {
      ...reqs,
      asset: checksumOrThrow(reqs.asset, 'asset'),
      payTo: checksumOrThrow(reqs.payTo, 'payTo'),
      extra: reqs.extra
        ? {
            ...reqs.extra,
            ...(reqs.extra.fee
              ? {
                  fee: {
                    ...reqs.extra.fee,
                    feeTo: checksumOrThrow(reqs.extra.fee.feeTo, 'extra.fee.feeTo'),
                    ...(reqs.extra.fee.caller
                      ? { caller: checksumOrThrow(reqs.extra.fee.caller, 'extra.fee.caller') }
                      : {}),
                  },
                }
              : {}),
          }
        : reqs.extra,
    };
  }
}

function checksumOrThrow(address: string, field: string): string {
  if (!isAddress(address, { strict: false })) {
    throw new Error(`Invalid EVM address for ${field}: ${address}`);
  }
  return getAddress(address);
}

function generateNonce(): string {
  // 16 random bytes, decimal-encoded — matches Python's str(uuid.uuid4().int) shape.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let nonce = 0n;
  for (const byte of bytes) {
    nonce = (nonce << 8n) | BigInt(byte);
  }
  return nonce.toString();
}
