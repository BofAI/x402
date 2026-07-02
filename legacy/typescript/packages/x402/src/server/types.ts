/**
 * Server-side type contracts for x402 SDK.
 *
 * - {@link ResourceConfig} — high-level config for a protected endpoint
 * - {@link ServerMechanism} — per-(network, scheme) plugin used by {@link X402Server}
 */

import type { AssetAmount } from '../tokens.js';
import type { PaymentPermit, PaymentRequirements } from '../types/index.js';

/**
 * Delivery modes for a protected resource. Only `PAYMENT_ONLY` ships today;
 * future modes (e.g. `RECEIPT_REQUIRED`) plug in here.
 */
export const PAYMENT_ONLY = 'PAYMENT_ONLY';

/**
 * One protected endpoint's payment configuration.
 *
 * Mirrors Python `bankofai.x402.server.ResourceConfig`.
 *
 * @example
 * ```ts
 * const cfg: ResourceConfig = {
 *   scheme: 'exact_permit',
 *   network: 'tron:nile',
 *   price: '1 USDT',
 *   payTo: 'TJWdoJ...',
 * };
 * ```
 */
export interface ResourceConfig {
  /** Payment scheme (`"exact"`, `"exact_permit"`, `"exact_gasfree"`, ...). */
  scheme: string;
  /** CAIP-2 network identifier (`"tron:nile"`, `"eip155:97"`, ...). */
  network: string;
  /** Human-readable price string parsed by {@link parsePrice} (e.g. `"1 USDT"`). */
  price: string;
  /** Recipient address. */
  payTo: string;
  /** Authorization validity window in seconds. Default 3600. */
  validFor?: number;
  /** Delivery mode. Default {@link PAYMENT_ONLY}. */
  deliveryMode?: string;
}

/**
 * Server-side mechanism interface.
 *
 * One instance per `(network, scheme)`. Implementations live in the
 * mechanism packages (TRON / EVM / ...) and plug into {@link X402Server} via
 * `register(network, mechanism)`.
 *
 * Mirrors Python `bankofai.x402.server.x402_server.ServerMechanism`.
 */
export interface ServerMechanism {
  /** Scheme name (matches `ResourceConfig.scheme`). */
  scheme(): string;
  /**
   * Resolve a `"<amount> <symbol>"` price string into a typed asset amount.
   * The default mechanism implementation delegates to {@link parsePrice}.
   */
  parsePrice(price: string, network: string): Promise<AssetAmount>;
  /**
   * Hook to attach scheme-specific extra fields onto `PaymentRequirements`
   * (e.g. `extra.name` / `extra.version` for permit tokens). Should return
   * the requirements (possibly mutated, but a fresh object is preferred).
   */
  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    deliveryMode: string,
  ): Promise<PaymentRequirements>;
  /** Sanity check on requirements (return false to reject the config). */
  validatePaymentRequirements(requirements: PaymentRequirements): boolean;
  /**
   * Optional server-side signature verification before delegating to facilitator.
   * Defense-in-depth — facilitator also verifies, but a misbehaving client / proxy
   * should be rejected here too. Return `true` if the signature is valid.
   *
   * Implementations that don't perform local verification should be omitted entirely;
   * {@link X402Server} treats an absent method as "trust the facilitator".
   */
  verifySignature?(
    permit: PaymentPermit | null | undefined,
    signature: string,
    network: string,
  ): Promise<boolean>;
}
