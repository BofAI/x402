/**
 * EVM client setup. Key custody is in `@bankofai/agent-wallet`;
 * `createClientEvmSigner` adapts the wallet (async address + `0x`-normalized
 * signatures), builds the viem client internally from the CAIP-2 network, and
 * forwards `signTransaction` so the client can sign the gas-sponsored Permit2
 * approve that plain-ERC20 tokens (e.g. BSC USDC) need. ERC-3009 tokens (e.g.
 * DHLU) need none of that.
 *
 * `EVM_NETWORKS` is just a list of CAIP-2 ids — each gets its own signer,
 * registered under its exact id (never `eip155:*`, since each chain needs its
 * own reads/broadcast). Adding a chain is one entry; the adapter resolves the
 * viem chain + RPC.
 */
import { createClientEvmSigner } from "@bankofai/x402-evm/adapters/agent-wallet";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";
import type { x402Client } from "@bankofai/x402-fetch";

import { tryResolveWallet } from "../env.js";

/** BSC testnet + mainnet; PAY_TARGETS decides which one the client pays on. */
const EVM_NETWORKS = ["eip155:97", "eip155:56"] as const;

// Optional RPC override for the EVM network(s). Without it the adapter uses viem's
// built-in default, which for BSC testnet is a public node that is frequently
// unreachable (`data-seed-prebsc-*.bnbchain.org:8545`). Only the permit2 path
// (e.g. BSC USDC, which signs a gas-sponsored approve) reads the chain; ERC-3009
// tokens (e.g. DHLU) sign offline and don't need RPC. Set a reliable endpoint,
// e.g. EVM_RPC_URL=https://bsc-testnet-rpc.publicnode.com
const EVM_RPC_URL = process.env.EVM_RPC_URL?.trim() || undefined;
const EVM_RPC_NETWORK =
  process.env.PAY_TARGETS?.split(",")
    .map((target) => target.trim().split("@", 1)[0])
    .find((network) => network?.startsWith("eip155:")) || "eip155:97";

/**
 * Registers the EVM `exact` client scheme for every configured network, if an
 * EVM wallet is configured.
 *
 * @param client - The x402 client to register the scheme on.
 * @returns `true` if at least one network registered, `false` if no EVM wallet.
 */
export async function registerEvm(client: x402Client): Promise<boolean> {
  const wallet = await tryResolveWallet("evm");
  if (!wallet) {
    return false;
  }

  for (const network of EVM_NETWORKS) {
    const signer = await createClientEvmSigner(wallet, {
      network,
      rpcUrl: network === EVM_RPC_NETWORK ? EVM_RPC_URL : undefined,
    });
    client.register(network, new ExactEvmScheme(signer));
    console.info(`[evm] client registered ${network} (${signer.address})`);
  }
  return true;
}
