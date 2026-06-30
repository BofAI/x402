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
import {
  createFacilitatorEvmSigner,
  type GasSponsoringFacilitatorEvmSigner,
} from "@bankofai/x402-evm/adapters/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/facilitator";
import {
  createErc20ApprovalGasSponsoringExtension,
  type Erc20ApprovalGasSponsoringSigner,
} from "@bankofai/x402-extensions";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 networks to settle on. Add an id here (e.g. "eip155:8453"). */
const EVM_NETWORKS = ["eip155:97"] as const;

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
  // across networks). Signing stays in the wallet; the SDK never sees the key.
  // The agent-wallet satisfies FacilitatorEvmWallet directly; the factory builds
  // the viem client internally and the wallet signs (no raw key in the SDK).
  const address = (await wallet.getAddress()) as `0x${string}`;

  const signers: Record<string, GasSponsoringFacilitatorEvmSigner> = {};
  for (const network of EVM_NETWORKS) {
    const signer = await createFacilitatorEvmSigner(wallet, { network });
    facilitator.register(network, new ExactEvmScheme(signer));
    signers[network] = signer;
    console.info(`[evm] facilitator registered ${network} (${address})`);
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
