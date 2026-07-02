/**
 * Token registry - Centralized management of token configurations for all networks
 */

export interface TokenInfo {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
  version?: string;
}

const TOKENS: Record<string, Record<string, TokenInfo>> = {
  'eip155:97': {
    USDT: {
      address: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
      decimals: 18,
      name: 'Tether USD',
      symbol: 'USDT',
    },
    USDC: {
      address: '0x64544969ed7EBf5f083679233325356EbE738930',
      decimals: 18,
      name: 'USD Coin',
      symbol: 'USDC',
    },
    DHLU: {
      address: '0x375cADdd2cB68cE82e3D9B075D551067a7b4B816',
      decimals: 6,
      name: 'DA HULU',
      symbol: 'DHLU',
      version: '1',
    },
  },
  'eip155:56': {
    USDC: {
      address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
      decimals: 18,
      name: 'USD Coin',
      symbol: 'USDC',
    },
    USDT: {
      address: '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
      name: 'Tether USD',
      symbol: 'USDT',
    },
    EPS: {
      address: '0xA7f552078dcC247C2684336020c03648500C6d9F',
      decimals: 18,
      name: 'Ellipsis',
      symbol: 'EPS',
    },
  },
  'tron:mainnet': {
    USDT: {
      address: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      name: 'Tether USD',
      symbol: 'USDT',
    },
    USDD: {
      address: 'TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz',
      decimals: 18,
      name: 'Decentralized USD',
      symbol: 'USDD',
    },
  },
  'tron:shasta': {
    USDT: {
      address: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
      decimals: 6,
      name: 'Tether USD',
      symbol: 'USDT',
    },
  },
  'tron:nile': {
    USDT: {
      address: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
      decimals: 6,
      name: 'Tether USD',
      symbol: 'USDT',
    },
    USDD: {
      address: 'TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK',
      decimals: 18,
      name: 'Decentralized USD',
      symbol: 'USDD',
    },
  },
};

/** Get token info by network and symbol */
export function getToken(network: string, symbol: string): TokenInfo | undefined {
  return TOKENS[network]?.[symbol.toUpperCase()];
}

/** Find token info by network and contract address */
export function findByAddress(network: string, address: string): TokenInfo | undefined {
  const tokens = TOKENS[network];
  if (!tokens) return undefined;
  const lower = address.toLowerCase();
  return Object.values(tokens).find(t => t.address.toLowerCase() === lower);
}

/** Get all tokens for a network */
export function getNetworkTokens(network: string): Record<string, TokenInfo> {
  return TOKENS[network] ?? {};
}

/** Register a custom token */
export function registerToken(network: string, token: TokenInfo): void {
  if (!TOKENS[network]) {
    TOKENS[network] = {};
  }
  TOKENS[network][token.symbol.toUpperCase()] = token;
}

/** Parsed asset amount returned by {@link parsePrice}. */
export interface AssetAmount {
  /** Amount in smallest unit (e.g. "1000000" for 1 USDT with 6 decimals). */
  amount: string;
  /** Token contract address on the network. */
  asset: string;
  /** Token decimals. */
  decimals: number;
  /** Token symbol (e.g. "USDT"). */
  symbol: string;
  /** Token display name. */
  name: string;
  /** EIP-712 / TIP-712 contract version (for permit) when applicable. */
  version?: string;
}

/**
 * Parse a human-readable price string into a typed asset amount.
 *
 * @param price - `"<decimal-amount> <symbol>"` (e.g. `"1.25 USDT"` or `"100 USDC"`).
 *                Whitespace-tolerant. `<symbol>` lookup is case-insensitive.
 * @param network - CAIP-2 network identifier (e.g. `"tron:nile"`, `"eip155:97"`).
 *
 * @throws if the price format is invalid, the amount cannot be parsed,
 *         the token is not registered on `network`, or the amount has more
 *         decimal places than the token supports.
 *
 * Mirrors `bankofai.x402.tokens.TokenRegistry.parse_price`.
 */
export function parsePrice(price: string, network: string): AssetAmount {
  const parts = price.trim().split(/\s+/);
  if (parts.length !== 2) {
    throw new Error(
      `Invalid price format: "${price}". Expected "<amount> <symbol>" (e.g. "1.25 USDT").`,
    );
  }
  const [amountStr, symbol] = parts as [string, string];

  if (!/^\d+(\.\d+)?$/.test(amountStr)) {
    throw new Error(`Invalid amount in price "${price}": "${amountStr}" is not a non-negative decimal.`);
  }

  const token = getToken(network, symbol);
  if (!token) {
    throw new Error(`Unknown token "${symbol}" on network "${network}".`);
  }

  // BigInt-safe smallest-unit conversion. Reject precision overflow.
  const [intPart, fracPart = ''] = amountStr.split('.') as [string, string?];
  if (fracPart.length > token.decimals) {
    throw new Error(
      `Amount "${amountStr}" has more decimal places (${fracPart.length}) than ${symbol} supports (${token.decimals}).`,
    );
  }
  const paddedFrac = fracPart.padEnd(token.decimals, '0');
  // strip leading zeros to keep canonical numeric string
  const combined = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  const amount = combined === '' ? '0' : combined;

  return {
    amount,
    asset: token.address,
    decimals: token.decimals,
    symbol: token.symbol,
    name: token.name,
    ...(token.version !== undefined ? { version: token.version } : {}),
  };
}
