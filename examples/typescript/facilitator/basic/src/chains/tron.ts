/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import {
  createFacilitatorTronSigner,
  TRON_NILE,
  TRON_MAINNET,
  TRON_SHASTA,
} from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** TRON testnets + mainnet. */
export const TRON_NETWORKS = [TRON_NILE, TRON_SHASTA, TRON_MAINNET] as const;

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
  let registered = false;
  for (const network of TRON_NETWORKS) {
    const wallet = await tryResolveWallet(network);
    if (!wallet) continue;
    const address = await wallet.getAddress();
    const signer = await createFacilitatorTronSigner(wallet, {
      network,
      apiKey: process.env.TRON_GRID_API_KEY,
    });
    facilitator.register(network, new ExactTronScheme(signer));
    console.info(`[tron] facilitator registered ${network} (${address})`);
    registered = true;
  }
  return registered;
}
