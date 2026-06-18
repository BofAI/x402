/**
 * EVM chain setup for the facilitator. Isolated here so `index.ts` stays
 * chain-agnostic and a reader can grok one chain without the other's noise.
 *
 * Key custody lives entirely in `@bankofai/agent-wallet`: the wallet signs,
 * the SDK never sees a raw key. `createFacilitatorEvmSigner` builds, signs (via
 * the wallet), and broadcasts settlement txs internally. The viem public client
 * provides only chain reads/broadcast — no account, no key.
 */
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import {
  createFacilitatorEvmSigner,
  type FacilitatorEvmWallet,
} from "@bankofai/x402-evm/facilitator/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const EVM_NETWORK = "eip155:84532"; // Base Sepolia

/**
 * Registers the EVM `exact` scheme on the facilitator, if an EVM wallet is
 * configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no EVM wallet was configured.
 */
export async function registerEvm(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.EVM_RPC_URL || undefined),
  });

  // Adapt the agent-wallet to the SDK's facilitator wallet shape. The address
  // is resolved eagerly; signing stays inside agent-wallet.
  const facWallet: FacilitatorEvmWallet = {
    address: (await wallet.getAddress()) as `0x${string}`,
    signTransaction: tx => wallet.signTransaction(tx),
  };

  const signer = createFacilitatorEvmSigner(publicClient, facWallet);
  facilitator.register(EVM_NETWORK, new ExactEvmScheme(signer));
  console.info(`[evm] facilitator registered ${EVM_NETWORK} (${facWallet.address})`);
  return true;
}
