/**
 * EVM setup for the upto resource server.
 *
 * Key-less: registers the `upto` server scheme and advertises `accepts` (the
 * authorization ceiling + payTo). The actual charge is decided per request in
 * `index.ts` via a `Settlement-Overrides` response header — the scheme/facilitator
 * settle only that amount (<= the advertised price).
 *
 * Prices use the `"$"` form: the scheme maps it to the network's default asset
 * (see `DEFAULT_STABLECOINS` in `@bankofai/x402-evm`). On BSC testnet that's USDC,
 * a **Permit2** token → the client authorizes via Permit2 (needs a one-time
 * `approve(Permit2)`). Adding a chain is one `EVM_NETWORKS` entry.
 */
import { UptoEvmScheme } from "@bankofai/x402-evm/upto/server";
import type { Network } from "@bankofai/x402-core/types";
import type { x402ResourceServer } from "@bankofai/x402-express";

/** CAIP-2 networks the server accepts upto payments on. */
const EVM_NETWORKS: Network[] = [
  "eip155:97",
  // BSC mainnet — REAL FUNDS. Uncomment to enable (default asset: USDT, permit2).
  // "eip155:56",
];

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `upto` server scheme for every configured network.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerEvm(resourceServer: x402ResourceServer): void {
  const payTo = process.env.EVM_ADDRESS as string;
  for (const network of EVM_NETWORKS) {
    resourceServer.register(network, new UptoEvmScheme());
    console.info(`[evm] server registered ${network} upto (payTo ${payTo})`);
  }
}

/**
 * Builds the `accepts` entries advertised for EVM upto payments — one per
 * network, priced at the authorization ceiling in `"$"` form.
 *
 * @param price - The authorization ceiling (e.g. `"$0.10"`).
 * @returns Payment-requirements accept entries.
 */
export function evmAccepts(price: string) {
  const payTo = process.env.EVM_ADDRESS as string;
  return EVM_NETWORKS.map(network => ({ scheme: "upto", network, payTo, price }));
}
