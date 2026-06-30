/**
 * Adaptation layer — CAIP-2 → viem client resolution.
 *
 * Centralizes the `eip155:<chainId>` → viem `Chain` → `PublicClient` construction
 * that callers previously hand-wired (importing a viem chain + `createPublicClient`
 * in every example). Known chains are resolved by id; an unknown chain is allowed
 * when an `rpcUrl` is supplied (built via `defineChain`). Adding a common chain is
 * one entry in `KNOWN_CHAINS`.
 */
import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { base, baseSepolia, bsc, bscTestnet, mainnet, sepolia } from "viem/chains";

import { getEvmChainId } from "../utils";

/** Common chains resolved by chain id (extend as needed). */
const KNOWN_CHAINS: Record<number, Chain> = {
  [mainnet.id]: mainnet,
  [sepolia.id]: sepolia,
  [base.id]: base,
  [baseSepolia.id]: baseSepolia,
  [bsc.id]: bsc,
  [bscTestnet.id]: bscTestnet,
};

/**
 * Resolves a viem `Chain` for a CAIP-2 network. Known chains are returned
 * directly; an unknown chain requires `rpcUrl` and is built via `defineChain`.
 *
 * @param network - CAIP-2 id, e.g. `"eip155:8453"`.
 * @param rpcUrl - Optional RPC URL (required for chains not in `KNOWN_CHAINS`).
 * @returns The resolved viem chain.
 */
export function resolveEvmChain(network: string, rpcUrl?: string): Chain {
  const chainId = getEvmChainId(network);
  const known = KNOWN_CHAINS[chainId];
  if (known) {
    return known;
  }
  if (!rpcUrl) {
    throw new Error(
      `Unknown EVM chain ${network}: not in KNOWN_CHAINS. Pass rpcUrl to use a custom chain.`,
    );
  }
  return defineChain({
    id: chainId,
    name: network,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/**
 * Builds a key-less viem `PublicClient` for a CAIP-2 network (reads + broadcast).
 *
 * @param network - CAIP-2 id, e.g. `"eip155:97"`.
 * @param rpcUrl - Optional RPC URL override; falls back to the chain's default.
 * @returns A viem public client.
 */
export function createEvmPublicClient(network: string, rpcUrl?: string): PublicClient {
  const chain = resolveEvmChain(network, rpcUrl);
  return createPublicClient({ chain, transport: http(rpcUrl) });
}
