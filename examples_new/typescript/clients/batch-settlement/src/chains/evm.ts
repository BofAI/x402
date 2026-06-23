/**
 * EVM client setup for batch-settlement. Key custody is in `@bankofai/agent-wallet`;
 * `createClientEvmSigner` adapts the wallet (async address, 0x-normalized
 * signatures) and wires `readContract` for on-chain channel-state recovery.
 *
 * On the first request to a fresh channel the scheme bundles a **Permit2 deposit**
 * (the BSC token advertised by the server is USDC, a plain BEP-20 → Permit2);
 * later requests are voucher-only. Permit2 requires a one-time `approve(Permit2)`
 * on the token — grant it once for the payer before the first run. Each EVM
 * network gets its own viem public client + signer, registered under its exact
 * CAIP-2 id. Adding a chain is one `EVM_NETWORKS` entry.
 */
import { createClientEvmSigner } from "@bankofai/x402-evm/adapters/agent-wallet";
import { BatchSettlementEvmScheme } from "@bankofai/x402-evm/batch-settlement/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet, type BatchClientOptions, type RefundableScheme } from "../env.js";

/** CAIP-2 networks to support. Add an id here (e.g. "eip155:8453"). */
const EVM_NETWORKS = ["eip155:97"] as const;

/**
 * Registers the EVM `batch-settlement` client scheme for every configured
 * network, if an EVM wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @param opts - Channel salt + deposit policy.
 * @returns Refundable handles (empty if no EVM wallet).
 */
export async function registerEvm(
  client: x402Client,
  opts: BatchClientOptions,
): Promise<RefundableScheme[]> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return [];
  }

  const schemes: RefundableScheme[] = [];
  for (const network of EVM_NETWORKS) {
    const signer = await createClientEvmSigner(wallet, { network });
    const scheme = new BatchSettlementEvmScheme(signer, {
      salt: opts.salt,
      depositPolicy: { depositMultiplier: opts.depositMultiplier },
    });
    client.register(network, scheme);
    schemes.push({ label: network, refund: (url, o) => scheme.refund(url, o) });
    console.info(`[evm] client registered ${network} batch-settlement (${signer.address})`);
  }
  return schemes;
}
