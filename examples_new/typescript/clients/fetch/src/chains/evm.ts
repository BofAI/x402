/**
 * EVM client setup. Key custody is in `@bankofai/agent-wallet`;
 * `createClientEvmSigner` adapts the wallet (async address + `0x`-normalized
 * signatures) and wires `readContract` for permit2 enrichment.
 */
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { createClientEvmSigner } from "@bankofai/x402-evm/client/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

/**
 * Registers the EVM `exact` client scheme, if an EVM wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if registered, `false` if no EVM wallet was configured.
 */
export async function registerEvm(client: x402Client): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.EVM_RPC_URL || undefined),
  });

  const signer = await createClientEvmSigner(wallet, publicClient);
  client.register("eip155:*", new ExactEvmScheme(signer));
  console.info(`[evm] client registered eip155:* (${signer.address})`);
  return true;
}
