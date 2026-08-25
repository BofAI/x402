import type { AssetAmount, Network } from "@bankofai/x402-core/types";
import { convertToTokenAmount as convertCoreTokenAmount } from "@bankofai/x402-core/utils";

/**
 * Token registry for TRON networks.
 *
 * Centralizes per-network TRC-20 metadata (address, decimals, TIP-712 domain,
 * default transfer method) so schemes, price parsing, balance checks, and token
 * selection share one source of truth instead of hardcoding a single USDT per
 * network.
 */
export interface TokenInfo {
  /** TRC-20 token contract address (Base58Check format). */
  address: string;
  /** Token decimal places (e.g. 6 for USDT, 18 for USDD). */
  decimals: number;
  /** TIP-712 domain name (must match the token's domain separator). */
  name: string;
  /** Token symbol (e.g. "USDT"). */
  symbol: string;
  /** TIP-712 domain version (must match the token's domain separator). */
  version?: string;
  /**
   * Transfer method override: `"permit2"` for tokens settled through Permit2 +
   * x402ExactPermit2Proxy (the case for mainstream TRC-20 such as USDT), or
   * `"eip3009"` for tokens implementing TIP-712 `transferWithAuthorization`.
   * Omit to let the scheme/facilitator decide.
   */
  assetTransferMethod?: "permit2" | "eip3009";
  /**
   * Set to `true` for permit2 tokens that also implement EIP-2612 `permit()`,
   * so the client can surface name/version to sign a gasless permit for the
   * Permit2 allowance.
   */
  supportsEip2612?: boolean;
}

/**
 * Built-in TRC-20 tokens indexed by CAIP-2 network and uppercased symbol.
 *
 * Note: `tron:0x2b6653dc`, `tron:0xcd8690dc`, and `tron:0x94a9059e` have Permit2 +
 * x402Permit2Proxy deployments, so their tokens default to `permit2`.
 */
const TOKENS: Record<string, Record<string, TokenInfo>> = {
  "tron:0x2b6653dc": {
    USDT: {
      address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
      decimals: 6,
      name: "Tether USD",
      symbol: "USDT",
      version: "1",
      assetTransferMethod: "permit2",
    },
    USDD: {
      address: "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
      decimals: 18,
      name: "Decentralized USD",
      symbol: "USDD",
      version: "1",
      assetTransferMethod: "permit2",
    },
  },
  "tron:0xcd8690dc": {
    USDT: {
      address: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
      decimals: 6,
      name: "Tether USD",
      symbol: "USDT",
      version: "1",
      assetTransferMethod: "permit2",
    },
    USDD: {
      address: "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK",
      decimals: 18,
      name: "Decentralized USD",
      symbol: "USDD",
      version: "1",
      assetTransferMethod: "permit2",
    },
  },
  "tron:0x94a9059e": {
    USDT: {
      address: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      decimals: 6,
      name: "Tether USD",
      symbol: "USDT",
      version: "1",
      assetTransferMethod: "permit2",
    },
  },
};

/**
 * Symbol used as each network's default stablecoin when a price omits a token.
 */
export const DEFAULT_ASSET_SYMBOL = "USDT";

/**
 * Get the default stablecoin symbol used when a price omits a token.
 *
 * @returns The default asset symbol (e.g. "USDT").
 */
export function getDefaultAssetSymbol(): string {
  return DEFAULT_ASSET_SYMBOL;
}

/**
 * Get token info by network and symbol (case-insensitive).
 *
 * @param network - CAIP-2 network identifier (e.g. "tron:0xcd8690dc").
 * @param symbol - Token symbol (e.g. "USDT"); matched case-insensitively.
 * @returns The token info, or undefined if not registered.
 */
export function getToken(network: Network, symbol: string): TokenInfo | undefined {
  return TOKENS[network]?.[symbol.toUpperCase()];
}

/**
 * Find token info by network and contract address (case-insensitive).
 *
 * @param network - CAIP-2 network identifier.
 * @param address - TRC-20 contract address (Base58Check).
 * @returns The token info, or undefined if no token matches.
 */
export function findByAddress(network: Network, address: string): TokenInfo | undefined {
  const tokens = TOKENS[network];
  if (!tokens) return undefined;
  const lower = address.toLowerCase();
  return Object.values(tokens).find(t => t.address.toLowerCase() === lower);
}

/**
 * Get all registered tokens for a network, keyed by uppercased symbol.
 *
 * @param network - CAIP-2 network identifier.
 * @returns A map of symbol to token info (empty object if none registered).
 */
export function getNetworkTokens(network: Network): Record<string, TokenInfo> {
  return TOKENS[network] ?? {};
}

/**
 * Register or override a custom token at runtime.
 *
 * @param network - CAIP-2 network identifier.
 * @param token - The token info to register; keyed by its uppercased symbol.
 */
export function registerToken(network: Network, token: TokenInfo): void {
  if (!TOKENS[network]) {
    TOKENS[network] = {};
  }
  TOKENS[network][token.symbol.toUpperCase()] = token;
}

/**
 * Resolve the decimal precision for an asset on a network.
 *
 * @param network - CAIP-2 network identifier.
 * @param address - TRC-20 contract address.
 * @returns The token's decimals, or 6 when the token is not registered.
 */
export function getDecimals(network: Network, address: string): number {
  return findByAddress(network, address)?.decimals ?? 6;
}

/**
 * Build the `extra` metadata for an AssetAmount from token info.
 *
 * TIP-712 (`eip3009`) tokens need name/version for the TransferWithAuthorization
 * domain. Permit2 tokens don't — except those that also support EIP-2612, where
 * the client needs name/version to sign a gasless permit() for the Permit2
 * approval. Mirrors the exact server scheme's default conversion.
 *
 * @param token - The token info to derive metadata from.
 * @returns The `extra` object for an AssetAmount.
 */
export function buildAssetExtra(token: TokenInfo): Record<string, unknown> {
  const includeTIP712Domain = !token.assetTransferMethod || !!token.supportsEip2612;
  return {
    ...(includeTIP712Domain && token.version !== undefined
      ? { name: token.name, version: token.version }
      : {}),
    ...(token.assetTransferMethod ? { assetTransferMethod: token.assetTransferMethod } : {}),
  };
}

/**
 * Convert a decimal amount to token units without silently turning a positive
 * price into a zero-value payment.
 *
 * @param decimalAmount - Decimal amount in display units.
 * @param decimals - Number of decimal places supported by the token.
 * @returns The amount in the token's smallest unit.
 * @throws If a positive amount is below the token's smallest unit.
 */
export function convertToTokenAmount(decimalAmount: string, decimals: number): string {
  const tokenAmount = convertCoreTokenAmount(decimalAmount, decimals);
  if (tokenAmount === "0" && /[1-9]/.test(decimalAmount)) {
    throw new Error(
      `Amount ${decimalAmount} is too small to represent with ${decimals} decimal places`,
    );
  }
  return tokenAmount;
}

/**
 * Parse a human-readable price string into a typed AssetAmount.
 *
 * @param price - `"<decimal-amount> <symbol>"` (e.g. `"1.25 USDT"`).
 *                Whitespace-tolerant; symbol lookup is case-insensitive.
 * @param network - CAIP-2 network identifier (e.g. `"tron:0xcd8690dc"`).
 * @returns The asset amount in smallest units, with token metadata in `extra`.
 * @throws If the format is invalid, the amount is not a non-negative decimal,
 *         the token is not registered, or the amount has more decimal places
 *         than the token supports.
 */
export function parsePrice(price: string, network: Network): AssetAmount {
  const parts = price.trim().split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(
      `Invalid price format: "${price}". Expected "<amount> <symbol>" (e.g. "1.25 USDT").`,
    );
  }
  const [amountStr, symbol] = parts as [string, string];

  if (!/^\d+(\.\d+)?$/.test(amountStr)) {
    throw new Error(
      `Invalid amount in price "${price}": "${amountStr}" is not a non-negative decimal.`,
    );
  }

  const token = getToken(network, symbol);
  if (!token) {
    throw new Error(`Unknown token "${symbol}" on network "${network}".`);
  }

  // BigInt-safe smallest-unit conversion. Reject precision overflow.
  const [intPart, fracPart = ""] = amountStr.split(".") as [string, string?];
  if (fracPart.length > token.decimals) {
    throw new Error(
      `Amount "${amountStr}" has more decimal places (${fracPart.length}) than ${token.symbol} supports (${token.decimals}).`,
    );
  }
  const amount = convertToTokenAmount(`${intPart}.${fracPart}`, token.decimals);

  return {
    asset: token.address,
    amount,
    extra: buildAssetExtra(token),
  };
}
