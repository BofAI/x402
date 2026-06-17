import type { Network } from "@x402/core/types";
import { findByAddress } from "./tokens";

/**
 * Facilitator fee model for TRON schemes.
 *
 * On TRON, energy (gas) for a TRC-20 settlement costs real value, so a
 * facilitator must recoup it from the payment token — unlike Coinbase's Base
 * deployment where gas is negligible and the protocol carries no fee. This
 * module holds the fee data model and pure validation helpers shared by the
 * `exact` scheme (advisory advertisement) and `exact_gasfree` (where the
 * provider actually deducts `feeAmount` from the GasFree wallet).
 */

/**
 * Fee terms attached to a payment requirement via `requirements.extra.fee`.
 */
export interface FeeInfo {
  /** Address that collects the facilitator fee (Base58Check). */
  feeTo: string;
  /** Fee amount in the token's smallest unit. */
  feeAmount: string;
  /** Optional caller the on-chain contract / relayer requires (e.g. provider). */
  caller?: string;
}

/**
 * Facilitator-side fee configuration.
 */
export interface ExactTronFeeConfig {
  /** Address that collects the fee. Defaults to the facilitator signer address. */
  feeTo?: string;
  /** Optional caller address required by the settling contract / relayer. */
  caller?: string;
  /**
   * Per-symbol base fee in smallest units (symbol uppercased before lookup).
   * Tokens absent from this map have no configured fee.
   */
  baseFee?: Record<string, string>;
  /**
   * Optional token allowlist (Base58Check addresses, matched case-insensitively).
   * When set, only listed tokens are accepted; when undefined, all tokens pass.
   */
  allowedTokens?: ReadonlyArray<string>;
}

/**
 * Resolve the configured base fee for an asset on a network.
 *
 * @param config - The facilitator fee configuration.
 * @param network - CAIP-2 network identifier.
 * @param asset - TRC-20 contract address.
 * @returns The base fee in smallest units, or null when no fee is configured
 *          for the asset (token unknown or symbol absent from `baseFee`).
 */
export function resolveBaseFee(
  config: ExactTronFeeConfig,
  network: Network,
  asset: string,
): bigint | null {
  if (!config.baseFee) return null;
  const token = findByAddress(network, asset);
  if (!token) return null;
  const raw = config.baseFee[token.symbol.toUpperCase()];
  if (raw === undefined) return null;
  return BigInt(raw);
}

/**
 * Check whether an asset is permitted by the fee config's token allowlist.
 *
 * @param config - The facilitator fee configuration.
 * @param asset - TRC-20 contract address.
 * @returns True when no allowlist is set or the asset is listed.
 */
export function isTokenAllowed(config: ExactTronFeeConfig, asset: string): boolean {
  if (!config.allowedTokens) return true;
  const lower = asset.toLowerCase();
  return config.allowedTokens.some(a => a.toLowerCase() === lower);
}

/**
 * Build the {@link FeeInfo} a facilitator advertises for an asset, if any.
 *
 * @param config - The facilitator fee configuration.
 * @param network - CAIP-2 network identifier.
 * @param asset - TRC-20 contract address.
 * @param defaultFeeTo - Fallback fee collector (typically the signer address).
 * @returns The fee terms, or undefined when no fee applies to the asset.
 */
export function buildFeeInfo(
  config: ExactTronFeeConfig,
  network: Network,
  asset: string,
  defaultFeeTo: string,
): FeeInfo | undefined {
  if (!isTokenAllowed(config, asset)) return undefined;
  const baseFee = resolveBaseFee(config, network, asset);
  if (baseFee === null) return undefined;
  const feeTo = config.feeTo ?? defaultFeeTo;
  return {
    feeTo,
    feeAmount: baseFee.toString(),
    ...(config.caller ? { caller: config.caller } : {}),
  };
}

/** Fee validation error reasons. */
export const FEE_TOKEN_NOT_ALLOWED = "fee_token_not_allowed";
export const FEE_UNSUPPORTED_TOKEN = "fee_unsupported_token";
export const FEE_AMOUNT_TOO_LOW = "fee_amount_too_low";
export const FEE_TO_MISMATCH = "fee_to_mismatch";

/**
 * Validate a presented {@link FeeInfo} against the facilitator's config.
 *
 * Pure (no I/O). Returns an error reason string on the first failure, or null
 * when the presented fee is acceptable.
 *
 * @param config - The facilitator fee configuration.
 * @param network - CAIP-2 network identifier.
 * @param asset - TRC-20 contract address being paid with.
 * @param presented - The fee terms carried by the payment payload/requirement.
 * @param normalize - Optional address normalizer for `feeTo` comparison
 *                    (defaults to lowercase). Pass an EVM-hex normalizer when
 *                    comparing TRON Base58 against hex.
 * @returns An error reason, or null if valid.
 */
export function validateFee(
  config: ExactTronFeeConfig,
  network: Network,
  asset: string,
  presented: FeeInfo,
  normalize: (addr: string) => string = a => a.toLowerCase(),
): string | null {
  if (!isTokenAllowed(config, asset)) {
    return FEE_TOKEN_NOT_ALLOWED;
  }
  const baseFee = resolveBaseFee(config, network, asset);
  if (baseFee === null) {
    return FEE_UNSUPPORTED_TOKEN;
  }
  if (BigInt(presented.feeAmount) < baseFee) {
    return FEE_AMOUNT_TOO_LOW;
  }
  if (config.feeTo && normalize(presented.feeTo) !== normalize(config.feeTo)) {
    return FEE_TO_MISMATCH;
  }
  return null;
}

/**
 * Extract a {@link FeeInfo} from a requirement/supported-kind `extra` object.
 *
 * @param extra - An `extra` record that may carry a `fee` field.
 * @returns The fee terms when present and well-formed, otherwise undefined.
 */
export function readFeeFromExtra(extra: Record<string, unknown> | undefined): FeeInfo | undefined {
  const fee = extra?.fee as Partial<FeeInfo> | undefined;
  if (!fee || typeof fee.feeTo !== "string" || typeof fee.feeAmount !== "string") {
    return undefined;
  }
  return {
    feeTo: fee.feeTo,
    feeAmount: fee.feeAmount,
    ...(typeof fee.caller === "string" ? { caller: fee.caller } : {}),
  };
}
