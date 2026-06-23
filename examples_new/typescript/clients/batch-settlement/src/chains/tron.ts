/**
 * TRON client setup for batch-settlement. Mirrors the EVM module: the
 * agent-wallet's methods are passed to `createClientTronSigner`, which resolves
 * the address and re-adds the `0x` prefix agent-wallet strips. The TronWeb
 * instance carries no private key.
 *
 * On `tron:nile` the server advertises USDT, a Permit2 token — the first request
 * opens the channel via a **Permit2 deposit**, which needs a one-time
 * `approve(Permit2)` from the payer. `signTransaction` lets the signer
 * auto-broadcast that approve (parity with the `exact` TRON client). Later
 * requests are voucher-only.
 */
import { TronWeb } from "tronweb";
import { createClientTronSigner } from "@bankofai/x402-tron";
import { BatchSettlementTronScheme } from "@bankofai/x402-tron/batch-settlement/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet, type BatchClientOptions, type RefundableScheme } from "../env.js";

const TRON_NETWORK = "tron:nile";
const NILE_RPC = "https://nile.trongrid.io";

/**
 * Registers the TRON `batch-settlement` client scheme, if a TRON wallet is
 * configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @param opts - Channel salt + deposit policy.
 * @returns Refundable handles (empty if no TRON wallet).
 */
export async function registerTron(
  client: x402Client,
  opts: BatchClientOptions,
): Promise<RefundableScheme[]> {
  const wallet = await tryResolveWallet("tron");
  if (!wallet) {
    return [];
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
    // Enables the signer to broadcast the one-time Permit2 approve (USDT deposit).
    signTransaction: tx => wallet.signTransaction(tx),
  });

  const scheme = new BatchSettlementTronScheme(signer, {
    salt: opts.salt,
    depositPolicy: { depositMultiplier: opts.depositMultiplier },
  });
  client.register(TRON_NETWORK, scheme);
  console.info(`[tron] client registered ${TRON_NETWORK} batch-settlement (${signer.address})`);
  return [{ label: TRON_NETWORK, refund: (url, o) => scheme.refund(url, o) }];
}
