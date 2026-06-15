/**
 * Project network identifier for TRON Mainnet.
 */
export const TRON_MAINNET_CAIP2 = "tron:mainnet";

/**
 * Project network identifier for the TRON Shasta testnet.
 */
export const TRON_SHASTA_CAIP2 = "tron:shasta";

/**
 * Project network identifier for the TRON Nile testnet.
 */
export const TRON_NILE_CAIP2 = "tron:nile";

/**
 * Supported TRON networks.
 */
export const SUPPORTED_TRON_NETWORKS = [
  TRON_MAINNET_CAIP2,
  TRON_SHASTA_CAIP2,
  TRON_NILE_CAIP2,
] as const;

/**
 * Mainnet USDT TRC-20 contract.
 */
export const TRON_MAINNET_USDT = "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj";

/**
 * USDT decimal precision on TRON.
 */
export const TRON_USDT_DECIMALS = 6;

/**
 * TRC-20 transfer(address,uint256) function selector.
 */
export const TRC20_TRANSFER_SELECTOR = "a9059cbb";

/**
 * Default maximum fee limit for a client-created TRC-20 transfer, in sun.
 */
export const DEFAULT_MAX_FEE_LIMIT_SUN = 100_000_000;

/**
 * Buffer required before a transaction expires.
 */
export const EXPIRATION_BUFFER_MS = 5_000;
