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
import { createFacilitatorEvmSigner } from "@bankofai/x402-evm/adapters/agent-wallet";
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 networks to settle upto payments on. Add an id here (e.g. "eip155:8453"). */
const EVM_NETWORKS = ["eip155:97"] as const;

// Optional RPC override. The default BSC testnet endpoint selected by viem is
// frequently unreachable, so use the same override as the exact facilitator.
const EVM_RPC_URL = process.env.EVM_RPC_URL?.trim() || undefined;
const EVM_RPC_NETWORK =
  process.env.PAY_TARGETS?.split(",")
    .map((target) => target.trim().split("@", 1)[0])
    .find((network) => network?.startsWith("eip155:")) || "eip155:97";

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

  for (const network of EVM_NETWORKS) {
    const signer = await createFacilitatorEvmSigner(wallet, {
      network,
      rpcUrl: network === EVM_RPC_NETWORK ? EVM_RPC_URL : undefined,
    });
    facilitator.register(network, new UptoEvmScheme(signer));
    console.info(`[evm] facilitator registered ${network} upto`);
  }
  return true;
}
