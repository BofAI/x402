export { ExactTronSchemeV1 } from "../exact/v1";

export const TRON_NETWORK_CHAIN_ID_MAP = {
  mainnet: 728126428,
  shasta: 2494104990,
  nile: 3448148188,
  "tron:mainnet": 728126428,
  "tron:shasta": 2494104990,
  "tron:nile": 3448148188,
} as const;

export type TronNetworkV1 = keyof typeof TRON_NETWORK_CHAIN_ID_MAP;

/** The list of supported V1 TRON network identifiers. */
export const NETWORKS: string[] = Object.keys(TRON_NETWORK_CHAIN_ID_MAP);

/**
 * Resolves a V1 TRON network identifier to its numeric chain ID.
 *
 * @param network - The V1 network identifier to resolve.
 * @returns The numeric chain ID for the requested network.
 */
export function getTronChainIdV1(network: string): number {
  const chainId = TRON_NETWORK_CHAIN_ID_MAP[network as TronNetworkV1];
  if (!chainId) {
    throw new Error(`Unsupported v1 network: ${network}`);
  }
  return chainId;
}
