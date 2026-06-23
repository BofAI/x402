/**
 * TRON GasFree client setup (scheme `exact_gasfree`).
 *
 * GasFree is TRON's gasless meta-transaction protocol: the payer signs a TIP-712
 * `PermitTransfer` over the GasFreeController, and a relayer (service provider)
 * submits it on-chain — paying TRX energy and deducting `maxFee` from the token.
 * The payer holds funds in their **GasFree custodial wallet** (NOT the main
 * wallet) and never needs TRX. Unlike the `exact` permit2 flow there is no
 * one-time `approve`, so the signer only needs `getAddress` + `signTypedData`.
 *
 * GasFree is TRON-only — there is no EVM counterpart.
 */
import { createClientTronSigner } from "@bankofai/x402-tron";
import { registerExactGasFreeTronScheme } from "@bankofai/x402-tron/gasfree/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveTronWallet } from "../env.js";

const TRON_NETWORK = "tron:nile";

/**
 * Registers the TRON `exact_gasfree` client scheme, if a TRON wallet resolves.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if registered, `false` when no TRON wallet was configured.
 */
export async function registerTronGasFree(client: x402Client): Promise<boolean> {
  const wallet = await tryResolveTronWallet();
  if (!wallet) {
    return false;
  }

  // The agent-wallet satisfies ClientTronWallet directly. GasFree needs no
  // on-chain approve (the relayer pays energy and submits), so `ensureAllowance`
  // / `signTransaction` is simply never invoked by the gasfree client scheme.
  const signer = await createClientTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });

  // Omitting apiBaseUrls falls back to the built-in GASFREE_API_BASE_URLS
  // (Nile testnet relayer). Override with GASFREE_API_URL to point at your own.
  registerExactGasFreeTronScheme(client, {
    signer,
    ...(process.env.GASFREE_API_URL
      ? { schemeOptions: { apiBaseUrls: { "tron:nile": process.env.GASFREE_API_URL } } }
      : {}),
  });
  console.info(`[tron] client registered tron:* exact_gasfree (${signer.address})`);
  return true;
}
