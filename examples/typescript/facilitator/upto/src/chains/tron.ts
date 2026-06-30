/**
 * TRON chain setup for the upto facilitator — mirrors the EVM module.
 *
 * `createFacilitatorTronSigner` sets the issuer address from the wallet and
 * builds/signs/broadcasts the on-chain Permit2 `settle` tx for the upto proxy
 * (the TronWeb instance carries no private key). The settled amount comes from
 * the server's `Settlement-Overrides` and must be <= the authorized maximum bound
 * in the client's Permit2 witness.
 */
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { UptoTronScheme } from "@bankofai/x402-tron/upto/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";

/**
 * Registers the TRON `upto` scheme on the facilitator, if a TRON wallet is
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

  // The agent-wallet satisfies FacilitatorTronWallet directly; the factory builds
  // TronWeb internally and the wallet signs the Permit2 `settle`.
  const address = await wallet.getAddress();
  const signer = await createFacilitatorTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });

  facilitator.register(TRON_NETWORK, new UptoTronScheme(signer));
  console.info(`[tron] facilitator registered ${TRON_NETWORK} upto (${address})`);
  return true;
}
