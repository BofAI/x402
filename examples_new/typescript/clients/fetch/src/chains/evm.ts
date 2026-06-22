/**
 * EVM client setup. Key custody is in `@bankofai/agent-wallet`;
 * `createClientEvmSigner` adapts the wallet (async address + `0x`-normalized
 * signatures), wires `readContract` for permit2 enrichment, and forwards
 * `signTransaction` so the client can sign the gas-sponsored Permit2 approve
 * that plain-ERC20 tokens (e.g. BSC USDC) need. ERC-3009 tokens (e.g. DHLU)
 * need none of that.
 *
 * Multiple EVM networks are supported via the `EVM_NETWORKS` table: each gets
 * its OWN viem public client + signer and is registered under its exact CAIP-2
 * id (never `eip155:*`, since each chain needs its own reads/broadcast). Adding
 * a chain (e.g. Base Sepolia) is one table entry.
 */
import { createPublicClient, http, type Chain } from "viem";
import { bscTestnet } from "viem/chains";
import { createClientEvmSigner } from "@bankofai/x402-evm/client/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

/** CAIP-2 network → viem chain. Add a chain here to support it. */
const EVM_NETWORKS: Record<string, Chain> = {
  "eip155:97": bscTestnet,
  // BSC mainnet — REAL FUNDS. Uncomment + `import { bsc } from "viem/chains"`.
  // Tokens are token-agnostic here; the server advertises which ones (USDC/USDT/EPS, all permit2).
  // "eip155:56": bsc,
  // Other EVM testnets, e.g. Base Sepolia (USDC via eip3009):
  // "eip155:84532": baseSepolia,
};

function resolveRpcUrl(network: string): string | undefined {
  if (process.env.EVM_RPC_URL) {
    return process.env.EVM_RPC_URL;
  }
  if (network === "eip155:97") {
    return process.env.BSC_TESTNET_RPC_URL;
  }
  return undefined;
}

/**
 * Registers the EVM client schemes for every configured network, if an EVM
 * wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if at least one network registered, `false` if no EVM wallet.
 */
export async function registerEvm(client: x402Client): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  for (const [network, chain] of Object.entries(EVM_NETWORKS) as [`${string}:${string}`, Chain][]) {
    const publicClient = createPublicClient({ chain, transport: http(resolveRpcUrl(network)) });
    const signer = await createClientEvmSigner(wallet, publicClient);
    client.register(network, new ExactEvmScheme(signer));
    client.register(network, new UptoEvmScheme(signer));
    console.info(`[evm] client registered exact+upto ${network} (${signer.address})`);
  }
  return true;
}
