/**
 * TRON GasFree chain setup for the facilitator (scheme `exact_gasfree`).
 *
 * Settlement does NOT broadcast a raw TRON tx: the facilitator forwards the
 * signed permit to the GasFree relayer API, which pays energy and submits it.
 * The `FacilitatorTronSigner` still supplies the issuer address and signs relayer
 * requests, so it is created the same way as the `exact` facilitator — key
 * custody stays in `@bankofai/agent-wallet`, and the TronWeb instance carries no
 * private key.
 */
import { createFacilitatorTronSigner } from "@bankofai/x402-tron";
import { registerExactGasFreeTronScheme } from "@bankofai/x402-tron/gasfree/facilitator";
import type { x402Facilitator } from "@bankofai/x402-core/facilitator";

import { tryResolveTronWallet } from "../env.js";

/** CAIP-2 network this facilitator settles on. */
export const TRON_NETWORK = "tron:0xcd8690dc";

/**
 * Registers the TRON `exact_gasfree` scheme on the facilitator, if a TRON wallet
 * resolves in agent-wallet.
 *
 * @param facilitator - The facilitator to register the scheme on.
 * @returns `true` if registered, `false` when no TRON wallet was configured.
 */
export async function registerTronGasFree(facilitator: x402Facilitator): Promise<boolean> {
  const wallet = await tryResolveTronWallet();
  if (!wallet) {
    return false;
  }

  // The agent-wallet satisfies FacilitatorTronWallet directly; settlement goes
  // through the GasFree relayer, so the signer only supplies the issuer + signing.
  const address = await wallet.getAddress();
  const signer = await createFacilitatorTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });

  // Omitting apiBaseUrls falls back to the built-in GASFREE_API_BASE_URLS
  // (Nile testnet relayer). Override with GASFREE_API_URL for your own relayer.
  registerExactGasFreeTronScheme(facilitator, {
    signer,
    networks: TRON_NETWORK,
    ...(process.env.GASFREE_API_URL
      ? { apiBaseUrls: { "tron:0xcd8690dc": process.env.GASFREE_API_URL } }
      : {}),
  });
  console.info(`[tron] facilitator registered ${TRON_NETWORK} exact_gasfree (${address})`);
  return true;
}
