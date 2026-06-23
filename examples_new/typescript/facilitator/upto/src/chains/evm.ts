/**
 * EVM chain setup for the upto facilitator.
 *
 * `createFacilitatorEvmSigner` builds/signs/broadcasts the on-chain Permit2
 * `settle` tx for the upto proxy (key custody stays in `@bankofai/agent-wallet`;
 * the viem public client is key-less, reads/broadcast only). The settled amount
 * comes from the server's `Settlement-Overrides` and must be <= the authorized
 * maximum bound in the client's Permit2 witness.
 *
 * The upto Permit2 proxy is a deterministic CREATE2 singleton at the same address
 * on every EVM chain, so adding a chain is one `EVM_NETWORKS` entry.
 */
import { createPublicClient, http, type Chain } from "viem";
import { bscTestnet } from "viem/chains";
import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmWallet,
} from "@bankofai/x402-evm/adapters/agent-wallet";
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { Network } from "@bankofai/x402-core/types";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network → viem chain. Add a chain here to settle upto payments on it. */
const EVM_NETWORKS: Record<string, Chain> = {
  "eip155:97": bscTestnet,
  // BSC mainnet — REAL FUNDS. Uncomment + `import { bsc } from "viem/chains"`.
  // "eip155:56": bsc,
};

/**
 * Registers the EVM `upto` scheme on the facilitator for every configured
 * network, if an EVM wallet is configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if at least one network registered, `false` if no EVM wallet.
 */
export async function registerEvm(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  const address = (await wallet.getAddress()) as `0x${string}`;
  const facWallet: FacilitatorEvmWallet = {
    address,
    signTransaction: tx => wallet.signTransaction(tx),
  };

  for (const [network, chain] of Object.entries(EVM_NETWORKS) as [Network, Chain][]) {
    const publicClient = createPublicClient({ chain, transport: http() });
    const signer = createFacilitatorEvmSigner(publicClient, facWallet);
    facilitator.register(network, new UptoEvmScheme(signer));
    console.info(`[evm] facilitator registered ${network} upto (${address})`);
  }
  return true;
}
