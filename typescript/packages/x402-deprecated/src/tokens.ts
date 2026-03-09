/**
 * Token registry - Centralized management of token configurations for all networks
 */

export interface TokenInfo {
  address: string;
  decimals: number;
  name: string;
  symbol: string;
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
