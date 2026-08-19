import type { DefaultAsset, Network } from "@bankofai/x402-core/types";
import { getToken, DEFAULT_ASSET_SYMBOL, type TokenInfo } from "./tokens";

/**
 * Base stablecoin asset configuration shared across TRON payment schemes.
 * Contains the core fields needed to identify and convert TRC-20 tokens.
 */
export type DefaultAssetInfo = {
  /** TRC-20 token contract address (Base58Check format) */
  address: string;
  /** TIP-712 domain name (must match the token's domain separator) */
  name: string;
  /** TIP-712 domain version (must match the token's domain separator) */
  version: string;
  /** Token decimal places (typically 6 for USDT) */
  decimals: number;
};

/**
 * Extended asset configuration for the exact scheme.
 * Includes transfer method hints that control client-side behaviour.
 */
export type ExactDefaultAssetInfo = DefaultAssetInfo & {
  /**
   * Transfer method override: `"permit2"` for tokens that don't implement
   * TIP-712 `transferWithAuthorization` (the case for mainstream TRC-20 such
   * as USDT). Omit to use the TIP-712 TransferWithAuthorization path.
   */
  assetTransferMethod?: string;
  /**
   * Set to `true` for permit2 tokens that also implement EIP-2612 `permit()`.
   * Controls whether name/version are surfaced so the client can sign a gasless
   * permit for the Permit2 allowance.
   */
  supportsEip2612?: boolean;
};

/**
 * Symbol used as each network's default stablecoin.
 *
 * The full token metadata lives in the token registry ({@link getToken}); this
 * module only resolves the default symbol to the registry entry so there is a
 * single source of truth.
 */
const DEFAULT_SYMBOL = DEFAULT_ASSET_SYMBOL;

/**
 * Map a registry {@link TokenInfo} to the exact-scheme asset shape.
 *
 * @param token - The registry token entry.
 * @returns The exact-scheme default asset info.
 */
function toExactAssetInfo(token: TokenInfo): ExactDefaultAssetInfo {
  return {
    address: token.address,
    name: token.name,
    version: token.version ?? "1",
    decimals: token.decimals,
    ...(token.assetTransferMethod ? { assetTransferMethod: token.assetTransferMethod } : {}),
    ...(token.supportsEip2612 ? { supportsEip2612: token.supportsEip2612 } : {}),
  };
}

/**
 * Get the default stablecoin asset info for a TRON network.
 *
 * Resolves the network's default symbol (USDT) against the token registry.
 *
 * @param network - The CAIP-2 network identifier (e.g., "tron:0xcd8690dc").
 * @returns The default asset configuration for the network.
 * @throws Error if no default asset is configured for the network.
 */
export function getDefaultAsset(network: Network): ExactDefaultAssetInfo {
  const token = getToken(network, DEFAULT_SYMBOL);
  if (!token) {
    throw new Error(`No default asset configured for TRON network ${network}`);
  }
  return toExactAssetInfo(token);
}

/**
 * Resolve a payment asset when it is the network's default stablecoin.
 * Used by core spend controls to distinguish default assets from opt-in assets.
 *
 * @param asset - TRC-20 contract address from payment requirements.
 * @param network - CAIP-2 TRON network identifier.
 * @returns Comparable default-asset metadata, or undefined for a non-default asset.
 */
export function findDefaultAsset(asset: string, network: Network): DefaultAsset | undefined {
  const token = getToken(network, DEFAULT_SYMBOL);
  if (!token || token.address !== asset) {
    return undefined;
  }
  return {
    asset: token.address,
    decimals: token.decimals,
    symbol: token.symbol,
  };
}
