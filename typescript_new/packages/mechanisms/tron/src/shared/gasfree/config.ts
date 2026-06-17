import { getTronChainId, tronAddressToEvm } from "../../utils";

/**
 * GasFree network configuration: on-chain controller/beacon addresses and the
 * relayer API endpoints, plus the TIP-712 domain helper.
 *
 * GasFree is TRON's native gasless meta-transaction protocol: the user signs a
 * `PermitTransfer` over the GasFreeController, and a service provider relays it,
 * paying energy and deducting a fee from the token. This module centralizes the
 * per-network constants needed to build/verify those permits.
 */

/** GasFreeController contract addresses (Base58Check) per network. */
export const GASFREE_CONTROLLER_ADDRESSES: Record<string, string> = {
  "tron:mainnet": "TFFAMQLZybALaLb4uxHA9RBE7pxhUAjF3U",
  "tron:shasta": "TQghdCeVDA6CnuNVTUhfaAyPfTetqZWNpm",
  "tron:nile": "THQGuFzL87ZqhxkgqYEryRAd7gqFqL5rdc",
};

/** GasFree beacon contract addresses (Base58Check) per network. */
export const GASFREE_BEACON_ADDRESSES: Record<string, string> = {
  "tron:mainnet": "TSP9UW6FQhT76XD2jWA6ipGMx3yGbjDffP",
  "tron:shasta": "TQ1jvA3nLDMDNbJoMPLzTPoqAg8NvZ5CCW",
  "tron:nile": "TLtCGmaxH3PbuaF6kbybwteZcHptEdgQGC",
};

/**
 * Default GasFree relayer API base URLs per network.
 *
 * These are sensible defaults; callers should override via the GasFree API
 * client / registration config when pointing at a different relayer.
 */
export const GASFREE_API_BASE_URLS: Record<string, string> = {
  "tron:mainnet": "https://open.gasfree.io/tron",
  "tron:nile": "https://open-test.gasfree.io/nile",
  "tron:shasta": "https://open-test.gasfree.io/shasta",
};

/**
 * Get the GasFreeController address (Base58Check) for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The controller address.
 * @throws Error if GasFree is not configured for the network.
 */
export function getGasFreeControllerAddress(network: string): string {
  const addr = GASFREE_CONTROLLER_ADDRESSES[network];
  if (!addr) {
    throw new Error(`GasFreeController not configured for network: ${network}`);
  }
  return addr;
}

/**
 * Get the default GasFree relayer API base URL for a network.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The API base URL.
 * @throws Error if no default API URL is configured for the network.
 */
export function getGasFreeApiBaseUrl(network: string): string {
  const url = GASFREE_API_BASE_URLS[network];
  if (!url) {
    throw new Error(`No GasFree API URL configured for network: ${network}`);
  }
  return url;
}

/**
 * Build the TIP-712 domain for GasFree signing on a network.
 * The `verifyingContract` is the GasFreeController in EVM-hex form.
 *
 * @param network - CAIP-2 network identifier.
 * @returns The TIP-712 domain object.
 */
export function getGasFreeDomain(network: string): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: `0x${string}`;
} {
  return {
    name: "GasFreeController",
    version: "V1.0.0",
    chainId: getTronChainId(network),
    verifyingContract: tronAddressToEvm(getGasFreeControllerAddress(network)),
  };
}
