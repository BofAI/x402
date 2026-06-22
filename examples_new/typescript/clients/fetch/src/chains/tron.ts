/**
 * TRON client setup. Mirrors the EVM module: the agent-wallet's methods are
 * passed straight to `createClientTronSigner`, which resolves the address and
 * normalizes the `0x` prefix agent-wallet strips. The TronWeb instance carries
 * no private key — it supplies contract reads and broadcasts the one-time
 * Permit2 `approve`.
 *
 * `signTransaction` lets the signer auto-broadcast the one-time `approve(Permit2)`
 * that USDT/USDD (no ERC-3009) need before their first payment — parity with the
 * Python client.
 */
import { TronWeb } from "tronweb";
import { createClientTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

const NILE_RPC = "https://nile.trongrid.io";

/**
 * Registers the TRON `exact` client scheme, if a TRON wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if registered, `false` if no TRON wallet was configured.
 */
export async function registerTron(client: x402Client): Promise<boolean> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return false;
  }

  const tronWeb = new TronWeb({
    fullHost: NILE_RPC,
    ...(process.env.TRON_GRID_API_KEY
      ? { headers: { "TRON-PRO-API-KEY": process.env.TRON_GRID_API_KEY } }
      : {}),
  });

  const signer = await createClientTronSigner(tronWeb, {
    getAddress: () => wallet.getAddress(),
    signTypedData: args => wallet.signTypedData(args),
    // Enables the signer to broadcast the one-time Permit2 approve (USDT/USDD).
    signTransaction: tx => wallet.signTransaction(tx),
  });
  client.register("tron:*", new ExactTronScheme(signer));
  console.info(`[tron] client registered tron:* (${signer.address})`);
  return true;
}
