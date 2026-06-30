/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";

/**
 * Registers the TRON `exact` scheme on the facilitator, if a TRON wallet is
 * configured in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  // Key-less: the agent-wallet satisfies FacilitatorTronWallet directly; the
  // factory builds TronWeb internally and the wallet signs (no raw key in SDK).
  const address = await wallet.getAddress();
  const signer = await createFacilitatorTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });
  facilitator.register(TRON_NETWORK, new ExactTronScheme(signer));
  console.info(`[tron] facilitator registered ${TRON_NETWORK} (${address})`);
  return true;
}
