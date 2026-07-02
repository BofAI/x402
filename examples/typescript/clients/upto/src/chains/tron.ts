/**
 * TRON client setup for the upto scheme. Mirrors the EVM module: the
 * agent-wallet's methods are passed to `createClientTronSigner`, which resolves
 * the address and re-adds the `0x` prefix agent-wallet strips. The TronWeb
 * instance carries no private key.
 *
 * On `tron:nile` the server advertises USDT, a **Permit2** token — the upto
 * payment is a Permit2 `PermitWitnessTransferFrom` signed for up to the
 * advertised maximum, and needs a one-time `approve(Permit2)` from the payer.
 * `signTransaction` lets the signer auto-broadcast that approve.
 */
import { createClientTronSigner } from "@bankofai/x402-tron";
import { UptoTronScheme } from "@bankofai/x402-tron/upto/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

const TRON_NETWORK = "tron:nile";

/**
 * Registers the TRON `upto` client scheme, if a TRON wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns The CAIP-2 networks registered (empty if no TRON wallet).
 */
export async function registerTron(client: x402Client): Promise<string[]> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return [];
  }

  const signer = await createClientTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });

  client.register(TRON_NETWORK, new UptoTronScheme(signer));
  console.info(`[tron] client registered ${TRON_NETWORK} upto (${signer.address})`);
  return [TRON_NETWORK];
}
