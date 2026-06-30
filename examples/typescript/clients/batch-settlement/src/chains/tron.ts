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
import { createClientTronSigner } from "@bankofai/x402-tron";
import { BatchSettlementTronScheme } from "@bankofai/x402-tron/batch-settlement/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet, type BatchClientOptions, type RefundableScheme } from "../env.js";

const TRON_NETWORK = "tron:nile";

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

  // The agent-wallet satisfies ClientTronWallet directly; the factory handles
  // `this`-binding and auto-broadcasts the one-time Permit2 approve (USDT deposit).
  const signer = await createClientTronSigner(wallet, {
    network: TRON_NETWORK,
    apiKey: process.env.TRON_GRID_API_KEY,
  });

  const scheme = new BatchSettlementTronScheme(signer, {
    salt: opts.salt,
    depositPolicy: { depositMultiplier: opts.depositMultiplier },
  });
  client.register(TRON_NETWORK, scheme);
  console.info(`[tron] client registered ${TRON_NETWORK} batch-settlement (${signer.address})`);
  return [{ label: TRON_NETWORK, refund: (url, o) => scheme.refund(url, o) }];
}
