/**
 * EVM client setup for the upto scheme. Key custody is in `@bankofai/agent-wallet`;
 * `createClientEvmSigner` adapts the wallet (async address, 0x-normalized
 * signatures) and wires `readContract` for on-chain reads.
 *
 * The `upto` payment is a **Permit2** `PermitWitnessTransferFrom` signed for up
 * to the server's advertised maximum; the facilitator later settles only the
 * amount the server requests (<= max). Permit2 needs a one-time `approve(Permit2)`
 * on the token — grant it once for the payer before the first run. Each EVM
 * network gets its own viem public client + signer, registered under its exact
 * CAIP-2 id. Adding a chain is one `EVM_NETWORKS` entry.
 */
import { createClientEvmSigner } from "@bankofai/x402-evm/adapters/agent-wallet";
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 networks to support. Add an id here (e.g. "eip155:8453"). */
const EVM_NETWORKS = ["eip155:97"] as const;

/**
 * Registers the EVM `upto` client scheme for every configured network, if an EVM
 * wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns The CAIP-2 networks registered (empty if no EVM wallet).
 */
export async function registerEvm(client: x402Client): Promise<string[]> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return [];
  }

  const registered: string[] = [];
  for (const network of EVM_NETWORKS) {
    const signer = await createClientEvmSigner(wallet, { network });
    client.register(network, new UptoEvmScheme(signer));
    registered.push(network);
    console.info(`[evm] client registered ${network} upto (${signer.address})`);
  }
  return registered;
}
