/**
 * TRON (Nile) client setup for MCP — mirrors the EVM module. The agent-wallet's
 * methods are passed straight to `createClientTronSigner`, which resolves the
 * address and auto-broadcasts the one-time Permit2 `approve` that USDT/USDD need.
 * Returns the scheme entries for `createx402MCPClient({ schemes })`.
 */
import { createClientTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import type { Network, SchemeNetworkClient } from "@bankofai/x402-core/types";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this client pays on. */
export const TRON_NETWORK: Network = "tron:0xcd8690dc";

/**
 * Builds the TRON `exact` client scheme registration, if a TRON wallet resolves.
 *
 * @returns Scheme entries for the MCP client (empty when no TRON wallet).
 */
export async function tronSchemes(): Promise<
  Array<{ network: Network; client: SchemeNetworkClient }>
> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return [];
  }
  const signer = await createClientTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });
  console.info(`[tron] client scheme ${TRON_NETWORK} (${signer.address})`);
  return [{ network: TRON_NETWORK, client: new ExactTronScheme(signer) }];
}
