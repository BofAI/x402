/**
 * TRON setup for the MCP resource server — mirrors the EVM module. Keyless: just
 * the `exact` server scheme on `tron:nile` and `accepts` with the payout address.
 *
 * Offers USDT and USDD (both permit2 tokens — no ERC-3009). The TRON client ships
 * an auto-approve that broadcasts the one-time Permit2 `approve`, so the server
 * needs no gas-sponsoring extension. Prices use the `"<amount> <symbol>"` form so
 * the TRON scheme resolves each token from its registry.
 */
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";
import type { Network } from "@bankofai/x402-core/types";
import type { ResourceConfig, x402ResourceServer } from "@bankofai/x402-core/server";

/** CAIP-2 network this server accepts TRON payments on. Switch to "tron:mainnet"
 *  for production (REAL FUNDS); USDT/USDD are registered there too. */
export const TRON_NETWORK: Network = "tron:nile";

/** TRON is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers the TRON `exact` server scheme on `tron:nile`.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerTron(resourceServer: x402ResourceServer): void {
  resourceServer.register(TRON_NETWORK, new ExactTronScheme());
}

/**
 * Builds the resource configs advertised for TRON payments — USDT and USDD.
 *
 * @returns Resource configs for buildPaymentRequirements.
 */
export function tronAccepts(): ResourceConfig[] {
  const payTo = process.env.TRON_ADDRESS as string;
  return ["0.001 USDT", "0.001 USDD"].map(
    price => ({ scheme: "exact", network: TRON_NETWORK, payTo, price }) as ResourceConfig,
  );
}
