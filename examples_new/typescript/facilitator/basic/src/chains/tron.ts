/**
 * TRON chain setup for the facilitator. Mirrors the EVM module: key custody is
 * in `@bankofai/agent-wallet`, and `createFacilitatorTronSigner` sets the
 * issuer address from the wallet (the TronWeb instance carries no private key).
 */
import { TronWeb } from "tronweb";
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:nile";
const NILE_RPC = "https://nile.trongrid.io";

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

  // No private key on TronWeb — createFacilitatorTronSigner sets the issuer
  // address from the wallet, and the wallet signs.
  const tronWeb = new TronWeb({
    fullHost: NILE_RPC,
    ...(process.env.TRON_GRID_API_KEY
      ? { headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY } }
      : {}),
  });

  const facWallet = {
    address: await wallet.getAddress(),
    signTransaction: (tx: Record<string, unknown>) => wallet.signTransaction(tx),
  };

  const signer = createFacilitatorTronSigner(tronWeb, facWallet);
  facilitator.register(TRON_NETWORK, new ExactTronScheme(signer));
  console.info(`[tron] facilitator registered ${TRON_NETWORK} (${facWallet.address})`);
  return true;
}
