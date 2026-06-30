/**
 * EVM (BSC testnet) client setup for MCP. Key custody is in
 * `@bankofai/agent-wallet`; `createClientEvmSigner` adapts the wallet and builds
 * the viem client internally from the CAIP-2 network. Returns the scheme entries
 * to hand to `createx402MCPClient({ schemes })` — empty when no EVM wallet.
 */
import { createClientEvmSigner } from "@bankofai/x402-evm/adapters/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";
import type { Network, SchemeNetworkClient } from "@bankofai/x402-core/types";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this client pays on (BSC testnet). */
export const EVM_NETWORK: Network = "eip155:97";

/**
 * Builds the EVM `exact` client scheme registration, if an EVM wallet resolves.
 *
 * @returns Scheme entries for the MCP client (empty when no EVM wallet).
 */
export async function evmSchemes(): Promise<
  Array<{ network: Network; client: SchemeNetworkClient }>
> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return [];
  }
  const signer = await createClientEvmSigner(wallet, { network: EVM_NETWORK });
  console.info(`[evm] client scheme ${EVM_NETWORK} (${signer.address})`);
  return [{ network: EVM_NETWORK, client: new ExactEvmScheme(signer) }];
}
