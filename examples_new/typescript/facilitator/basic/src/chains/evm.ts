/**
 * EVM chain setup for the facilitator. Isolated here so `index.ts` stays
 * chain-agnostic and a reader can grok one chain without the other's noise.
 *
 * Key custody lives entirely in `@bankofai/agent-wallet`: the wallet signs,
 * the SDK never sees a raw key. `createFacilitatorEvmSigner` builds, signs (via
 * the wallet), and broadcasts settlement txs internally. The viem public client
 * provides only chain reads/broadcast — no account, no key.
 *
 * Multiple EVM networks are supported via the `EVM_NETWORKS` table: each gets
 * its own public client + signer, registered under its CAIP-2 id. The ERC-20
 * approval gas-sponsoring extension is registered once with a per-network signer
 * resolver, so USDC-style (permit2, no EIP-2612) approves are broadcast on the
 * right chain. Adding a chain (e.g. Base Sepolia) is one table entry.
 */
import { createPublicClient, http, type Chain } from "viem";
import { bscTestnet } from "viem/chains";
import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmWallet,
  type GasSponsoringFacilitatorEvmSigner,
} from "@bankofai/x402-evm/facilitator/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/facilitator";
import {
  createErc20ApprovalGasSponsoringExtension,
  type Erc20ApprovalGasSponsoringSigner,
} from "@bankofai/x402-extensions";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";
import type { Network } from "@bankofai/x402-core/types";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network → viem chain. Add a chain here to settle on it. */
const EVM_NETWORKS: Record<string, Chain> = {
  "eip155:97": bscTestnet,
  // BSC mainnet — REAL FUNDS. Uncomment + `import { bsc } from "viem/chains"`.
  // The gas-sponsoring extension auto-covers it via the per-network signer resolver.
  // "eip155:56": bsc,
  // Other EVM testnets, e.g. Base Sepolia:
  // "eip155:84532": baseSepolia,
};

/**
 * Registers the EVM `exact` scheme on the facilitator for every configured
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

  // Adapt the agent-wallet to the SDK's facilitator wallet shape (one key, used
  // across networks). The address is resolved eagerly; signing stays in the wallet.
  const facWallet: FacilitatorEvmWallet = {
    address: (await wallet.getAddress()) as `0x${string}`,
    signTransaction: tx => wallet.signTransaction(tx),
  };

  const signers: Record<string, GasSponsoringFacilitatorEvmSigner> = {};
  for (const [network, chain] of Object.entries(EVM_NETWORKS) as [Network, Chain][]) {
    const publicClient = createPublicClient({ chain, transport: http() });
    const signer = createFacilitatorEvmSigner(publicClient, facWallet);
    facilitator.register(network, new ExactEvmScheme(signer));
    signers[network] = signer;
    console.info(`[evm] facilitator registered ${network} (${facWallet.address})`);
  }

  // Register the ERC-20 approval gas-sponsoring extension once, resolving the
  // per-network signer (each `signer` already exposes `sendTransactions`). Lets
  // the facilitator broadcast the client's pre-signed Permit2 approve + settle.
  const defaultSigner = Object.values(signers)[0] as Erc20ApprovalGasSponsoringSigner;
  facilitator.registerExtension(
    createErc20ApprovalGasSponsoringExtension(
      defaultSigner,
      network => signers[network] as Erc20ApprovalGasSponsoringSigner | undefined,
    ),
  );
  return true;
}
