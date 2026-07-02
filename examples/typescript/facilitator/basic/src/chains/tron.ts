/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** TRON testnet + mainnet. */
export const TRON_NETWORKS = ["tron:nile", "tron:mainnet"] as const;

/**
 * Registers the TRON `exact` scheme on the facilitator, if a TRON wallet is
 * configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(
  facilitator: x402Facilitator,
): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  // Key-less: the agent-wallet satisfies FacilitatorTronWallet directly; the
  // factory builds TronWeb internally and the wallet signs (no raw key in SDK).
  const address = await wallet.getAddress();
  for (const network of TRON_NETWORKS) {
    const signer = await createFacilitatorTronSigner(wallet, {
      network,
      apiKey: process.env.TRON_GRID_API_KEY,
    });
    facilitator.register(network, new ExactTronScheme(signer));
    console.info(`[tron] facilitator registered ${network} (${address})`);
  }
  return true;
}
