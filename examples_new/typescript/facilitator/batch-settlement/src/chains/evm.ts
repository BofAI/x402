/**
 * EVM chain setup for the batch-settlement facilitator.
 *
 * The facilitator plays two roles here:
 *   1. **submitter** — `createFacilitatorEvmSigner` builds/signs/broadcasts the
 *      on-chain `deposit` / `claimWithSignature` / `settle` / `refund` txs (key
 *      custody stays in `@bankofai/agent-wallet`; the viem public client is
 *      key-less, reads/broadcast only).
 *   2. **receiver-authorizer** — the `authorizerSigner` produces the EIP-712
 *      signatures that authorize batched claims and refunds. We reuse the same
 *      agent-wallet for it (its address is published via `/supported` as
 *      `receiverAuthorizer`, which the server embeds into every channel config).
 *
 * The batch-settlement contract is a deterministic CREATE2 singleton at the same
 * address on every EVM chain, so adding a chain is one `EVM_NETWORKS` entry.
 */
import { createPublicClient, http, type Chain } from "viem";
import { bscTestnet } from "viem/chains";
import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmWallet,
} from "@bankofai/x402-evm/adapters/agent-wallet";
import { BatchSettlementEvmScheme } from "@bankofai/x402-evm/batch-settlement/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { Network } from "@bankofai/x402-core/types";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network → viem chain. Add a chain here to settle batches on it. */
const EVM_NETWORKS: Record<string, Chain> = {
  "eip155:97": bscTestnet,
  // BSC mainnet — REAL FUNDS. Uncomment + `import { bsc } from "viem/chains"`.
  // "eip155:56": bsc,
};

/**
 * Registers the EVM `batch-settlement` scheme on the facilitator for every
 * configured network, if an EVM wallet is configured in agent-wallet.
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

  // One key, used across networks. Address resolved eagerly; signing stays in
  // the wallet.
  const facWallet: FacilitatorEvmWallet = {
    address,
    signTransaction: tx => wallet.signTransaction(tx),
  };

  // Receiver-authorizer: signs claim/refund EIP-712 digests. Structurally an
  // `AuthorizerSigner` — agent-wallet returns a 0x-prefixed signature already.
  const authorizerSigner = {
    address,
    signTypedData: async (params: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> => {
      const sig = await wallet.signTypedData(params);
      return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
    },
  };

  for (const [network, chain] of Object.entries(EVM_NETWORKS) as [Network, Chain][]) {
    const publicClient = createPublicClient({ chain, transport: http() });
    const signer = createFacilitatorEvmSigner(publicClient, facWallet);
    facilitator.register(network, new BatchSettlementEvmScheme(signer, authorizerSigner));
    console.info(`[evm] facilitator registered ${network} batch-settlement (${address})`);
  }
  return true;
}
