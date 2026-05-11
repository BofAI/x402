/**
 * X402Facilitator — TypeScript port of `bankofai.x402.facilitator.X402Facilitator`.
 *
 * The core in-process payment processor for an x402 facilitator service.
 * Manages a registry of {@link FacilitatorMechanism}s keyed by `(network, scheme)`
 * and routes verify / settle / feeQuote calls to the right implementation.
 *
 * This is the *engine* — wrap it with an HTTP server (Hono / Express / Fastify)
 * to expose `/verify`, `/settle`, `/supported`, `/fee/quote` endpoints.
 */

import { getAddress, isAddress } from 'viem';

import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '../types/index.js';

/**
 * Server-side mechanism interface for the facilitator.
 *
 * One per `(network, scheme)` pair. Implementations live in the chain-specific
 * mechanism packages (TRON / EVM / etc.) — this interface keeps the facilitator
 * core agnostic of any particular chain.
 */
export interface FacilitatorMechanism {
  /** Scheme name this mechanism handles (e.g. `"exact"`, `"exact_permit"`). */
  scheme(): string;
  /**
   * Optional fee quote for a single requirement. Return `null` when this
   * mechanism cannot quote the requirement (e.g. token not in registry).
   */
  feeQuote(
    accept: PaymentRequirements,
    context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null>;
  /** Off-chain signature / replay / timing verification. */
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse>;
  /** On-chain settlement. */
  settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}

/** Optional logger interface for observability hooks. */
export interface FacilitatorLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

const consoleLogger: FacilitatorLogger = {
  warn: (msg, meta) => console.warn(`[X402Facilitator] ${msg}`, meta ?? ''),
  error: (msg, meta) => console.error(`[X402Facilitator] ${msg}`, meta ?? ''),
};

/**
 * In-process payment processor. Mirrors the Python `X402Facilitator` 1:1.
 *
 * @example
 * ```ts
 * const facilitator = new X402Facilitator()
 *   .register(['tron:nile'], tronExactMechanism)
 *   .register(['eip155:97'], bscExactPermitMechanism);
 *
 * const verifyResult = await facilitator.verify(payload, requirements);
 * if (verifyResult.isValid) {
 *   const settleResult = await facilitator.settle(payload, requirements);
 * }
 * ```
 */
export class X402Facilitator {
  /** network → scheme → mechanism */
  private readonly mechanisms = new Map<string, Map<string, FacilitatorMechanism>>();

  private readonly logger: FacilitatorLogger;

  constructor(opts?: { logger?: FacilitatorLogger }) {
    this.logger = opts?.logger ?? consoleLogger;
  }

  /**
   * Register a mechanism for a list of networks. Returns `this` for chaining.
   */
  register(networks: string[], mechanism: FacilitatorMechanism): this {
    const scheme = mechanism.scheme();
    for (const network of networks) {
      let bucket = this.mechanisms.get(network);
      if (!bucket) {
        bucket = new Map<string, FacilitatorMechanism>();
        this.mechanisms.set(network, bucket);
      }
      bucket.set(scheme, mechanism);
    }
    return this;
  }

  /** Snapshot of registered `(x402Version, scheme, network)` triples. */
  supported(): SupportedResponse {
    const kinds: SupportedResponse['kinds'] = [];
    for (const [network, schemes] of this.mechanisms) {
      for (const scheme of schemes.keys()) {
        kinds.push({ x402Version: 2, scheme, network });
      }
    }
    return { kinds };
  }

  /**
   * Fee quotes for a list of requirements. Unsupported `(network, scheme)` /
   * mechanisms returning `null` are silently skipped — the result list may be
   * shorter than the input. Per-mechanism exceptions surface as a thrown
   * `Error` (caller decides whether to 4xx or 5xx the HTTP request).
   */
  async feeQuote(
    accepts: PaymentRequirements[],
    context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse[]> {
    const results: FeeQuoteResponse[] = [];
    for (const accept of accepts) {
      const normalized = this.tryNormalizeEvmRequirements(accept);
      const mechanism = this.findMechanism(normalized.network, normalized.scheme);
      if (!mechanism) {
        continue;
      }
      try {
        const quote = await mechanism.feeQuote(normalized, context);
        if (quote !== null) {
          results.push(quote);
        }
      } catch (err) {
        throw new Error(
          `Fee quote failed for ${normalized.network}/${normalized.scheme}: ${(err as Error).message}`,
          { cause: err },
        );
      }
    }
    return results;
  }

  /**
   * Verify a payment payload off-chain. Always returns a {@link VerifyResponse};
   * mechanism exceptions become `isValid: false` with the message as
   * `invalidReason` and a logger.error entry.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const mechanism = this.findMechanism(requirements.network, requirements.scheme);
    if (!mechanism) {
      return {
        isValid: false,
        invalidReason: `unsupported_network_scheme: ${requirements.network}/${requirements.scheme}`,
      };
    }
    let normalized: PaymentRequirements;
    try {
      normalized = this.normalizeEvmRequirements(requirements);
    } catch (err) {
      return { isValid: false, invalidReason: (err as Error).message };
    }
    try {
      return await mechanism.verify(payload, normalized);
    } catch (err) {
      this.logger.error('verify failed', {
        network: normalized.network,
        scheme: normalized.scheme,
        error: (err as Error).message,
      });
      return { isValid: false, invalidReason: (err as Error).message };
    }
  }

  /**
   * Execute on-chain settlement. Always returns a {@link SettleResponse};
   * exceptions become `success: false` with `errorReason` set.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const mechanism = this.findMechanism(requirements.network, requirements.scheme);
    if (!mechanism) {
      return {
        success: false,
        network: requirements.network,
        errorReason: `unsupported_network_scheme: ${requirements.network}/${requirements.scheme}`,
      };
    }
    let normalized: PaymentRequirements;
    try {
      normalized = this.normalizeEvmRequirements(requirements);
    } catch (err) {
      return {
        success: false,
        network: requirements.network,
        errorReason: (err as Error).message,
      };
    }
    try {
      return await mechanism.settle(payload, normalized);
    } catch (err) {
      this.logger.error('settle failed', {
        network: normalized.network,
        scheme: normalized.scheme,
        error: (err as Error).message,
      });
      return {
        success: false,
        network: normalized.network,
        errorReason: (err as Error).message,
      };
    }
  }

  private findMechanism(network: string, scheme: string): FacilitatorMechanism | null {
    return this.mechanisms.get(network)?.get(scheme) ?? null;
  }

  /**
   * Strict variant — throws if any EVM address fails checksum. Used in verify /
   * settle so the failure message ends up in the response.
   */
  private normalizeEvmRequirements(reqs: PaymentRequirements): PaymentRequirements {
    if (!reqs.network.startsWith('eip155:')) {
      return reqs;
    }
    return {
      ...reqs,
      asset: this.checksumAddressStrict(reqs.asset, 'asset'),
      payTo: this.checksumAddressStrict(reqs.payTo, 'payTo'),
      extra: reqs.extra
        ? {
            ...reqs.extra,
            fee: reqs.extra.fee
              ? {
                  ...reqs.extra.fee,
                  feeTo: this.checksumAddressStrict(reqs.extra.fee.feeTo, 'extra.fee.feeTo'),
                  caller: reqs.extra.fee.caller
                    ? this.checksumAddressStrict(reqs.extra.fee.caller, 'extra.fee.caller')
                    : reqs.extra.fee.caller,
                }
              : reqs.extra.fee,
          }
        : reqs.extra,
    };
  }

  /**
   * Lenient variant for `feeQuote` — invalid-EVM-input requirements are simply
   * skipped (returning the original so they can be filtered out by mechanism
   * lookup miss).
   */
  private tryNormalizeEvmRequirements(reqs: PaymentRequirements): PaymentRequirements {
    try {
      return this.normalizeEvmRequirements(reqs);
    } catch {
      return reqs;
    }
  }

  private checksumAddressStrict(address: string, fieldName: string): string {
    if (!isAddress(address, { strict: false })) {
      throw new Error(`Invalid EVM address for ${fieldName}: ${address}`);
    }
    return getAddress(address);
  }
}
