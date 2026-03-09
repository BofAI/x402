/**
 * Network configuration for x402 protocol
 * Centralized configuration for contract addresses and chain IDs
 */

import { UnsupportedNetworkError } from './errors.js';

/** Chain IDs for supported networks */
export const CHAIN_IDS: Record<string, number> = {
  // TRON networks
  'tron:mainnet': 728126428, // 0x2b6653dc
  'tron:shasta': 2494104990, // 0x94a9059e
  'tron:nile': 3448148188, // 0xcd8690dc

  // EVM networks
  'eip155:1': 1, // Ethereum Mainnet
  'eip155:11155111': 11155111, // Sepolia
  'eip155:56': 56, // BSC Mainnet
  'eip155:97': 97, // BSC Testnet
};

/** Network identifier constants */
export const NETWORKS = {
  TRON_MAINNET: 'tron:mainnet',
  TRON_SHASTA: 'tron:shasta',
  TRON_NILE: 'tron:nile',
  EVM_MAINNET: 'eip155:1',
  EVM_SEPOLIA: 'eip155:11155111',
  BSC_MAINNET: 'eip155:56',
  BSC_TESTNET: 'eip155:97',
} as const;

/** PaymentPermit contract addresses */
export const PAYMENT_PERMIT_ADDRESSES: Record<string, string> = {
  'tron:mainnet': 'TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn',
  'tron:shasta': 'TR2XninQ3jsvRRLGTifFyUHTBysffooUjt',
  'tron:nile': 'TFxDcGvS7zfQrS1YzcCMp673ta2NHHzsiH',
  'eip155:97': '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
  'eip155:56': '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
};

/** GasFreeController contract addresses */
export const GASFREE_CONTROLLER_ADDRESSES: Record<string, string> = {
  'tron:mainnet': 'TFFAMLQZybALab4uxHA9RBE7pxhUAjfF3U',
  'tron:shasta': 'TQghdCeVDA6CnuNVTUhfaAyPfTetqZWNpm',
  'tron:nile': 'THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc',
};

/** GasFree beacon addresses */
export const GASFREE_BEACON_ADDRESSES: Record<string, string> = {
  'tron:mainnet': 'TSP9UW6FQhT76XD2jWA6ipGMx3yGbjDffP',
  'tron:shasta': 'TQ1jvA3nLDMDNbJoMPLzTPoqAg8NvZ5CCW',
  'tron:nile': 'TLtCGmaxH3PbuaF6kbybwteZcHptEdgQGC',
};

/** GasFree API Base URLs */
export const GASFREE_API_BASE_URLS: Record<string, string> = {
  'tron:mainnet': 'https://open.gasfree.io/tron',
  'tron:shasta': 'https://open-test.gasfree.io/shasta',
  'tron:nile': 'https://open-test.gasfree.io/nile',
};

/** Default RPC URLs for EVM networks */
export const EVM_RPC_URLS: Record<string, string> = {
  'eip155:97': 'https://data-seed-prebsc-1-s1.binance.org:8545/',
  'eip155:56': 'https://bsc-dataseed.binance.org/',
  // 'eip155:1': 'https://eth.llamarpc.com',
};

/** Default TronGrid hosts for TRON networks */
export const TRON_RPC_URLS: Record<string, string> = {
  'tron:mainnet': 'https://api.trongrid.io',
  'tron:shasta': 'https://api.shasta.trongrid.io',
  'tron:nile': 'https://nile.trongrid.io',
};

/**
 * Resolve a network identifier to an RPC URL.
 * Returns the URL from the built-in map, or undefined if not configured.
 */
export function resolveRpcUrl(network: string): string | undefined {
  return EVM_RPC_URLS[network] ?? TRON_RPC_URLS[network];
}

/** Zero address for TRON */
export const TRON_ZERO_ADDRESS = 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';

/** Zero address for EVM */
export const EVM_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Get chain ID for network
 */
export function getChainId(network: string): number {
  // EVM networks encode chain ID directly in the identifier
  if (network.startsWith('eip155:')) {
    const id = parseInt(network.split(':')[1], 10);
    if (isNaN(id)) {
      throw new UnsupportedNetworkError(`Invalid EVM network: ${network}`);
    }
    return id;
  }

  const chainId = CHAIN_IDS[network];
  if (chainId === undefined) {
    throw new UnsupportedNetworkError(`Unsupported network: ${network}`);
  }
  return chainId;
}

/**
 * Get PaymentPermit contract address for network
 */
export function getPaymentPermitAddress(network: string): string {
  const addr = PAYMENT_PERMIT_ADDRESSES[network];
  if (addr) return addr;
  // EVM fallback: zero address (not yet deployed)
  if (network.startsWith('eip155:')) return EVM_ZERO_ADDRESS;
  return TRON_ZERO_ADDRESS;
}

/**
 * Get GasFreeController contract address for network
 */
export function getGasFreeControllerAddress(network: string): string {
  return GASFREE_CONTROLLER_ADDRESSES[network] ?? TRON_ZERO_ADDRESS;
}

/**
 * Get GasFree beacon address for network
 */
export function getGasFreeBeaconAddress(network: string): string {
  return GASFREE_BEACON_ADDRESSES[network] ?? TRON_ZERO_ADDRESS;
}

/**
 * Get GasFree API Base URL for network
 */
export function getGasFreeApiBaseUrl(network: string): string {
  return GASFREE_API_BASE_URLS[network] ?? 'https://api.gasfree.io/v1';
}

/**
 * Get GasFree API Key
 */
export function getGasFreeApiKey(network?: string): string | undefined {
  if (typeof process !== 'undefined') {
    if (network) {
      const suffix = network.split(':').pop()?.toUpperCase();
      const networkKey = process.env[`GASFREE_API_KEY_${suffix}`];
      if (networkKey) return networkKey;
    }
    return process.env.GASFREE_API_KEY;
  }
  return undefined;
}

/**
 * Get GasFree API Secret
 */
export function getGasFreeApiSecret(network?: string): string | undefined {
  if (typeof process !== 'undefined') {
    if (network) {
      const suffix = network.split(':').pop()?.toUpperCase();
      const networkSecret = process.env[`GASFREE_API_SECRET_${suffix}`];
      if (networkSecret) return networkSecret;
    }
    return process.env.GASFREE_API_SECRET;
  }
  return undefined;
}

/**
 * Check if network is TRON
 */
export function isTronNetwork(network: string): boolean {
  return network.startsWith('tron:');
}

/**
 * Check if network is EVM
 */
export function isEvmNetwork(network: string): boolean {
  return network.startsWith('eip155:');
}

/**
 * Get zero address for network
 */
export function getZeroAddress(network: string): string {
  if (isEvmNetwork(network)) return EVM_ZERO_ADDRESS;
  if (isTronNetwork(network)) return TRON_ZERO_ADDRESS;
  throw new UnsupportedNetworkError(`Unsupported network: ${network}`);
}
