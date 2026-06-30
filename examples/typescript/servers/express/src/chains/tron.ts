/**
 * TRON setup for the resource server — mirrors the EVM module. Keyless: just the
 * `exact` server scheme and `accepts` entries with the TRON payout address.
 *
 * Offers both USDT and USDD on `tron:nile`. Both are permit2 tokens (no ERC-3009);
 * the client's shipped auto-approve handles the one-time Permit2 `approve`. Prices
 * use the `"<amount> <symbol>"` form so the TRON scheme resolves each token from
 * its registry (USDD is registered alongside USDT).
 */
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

// Switch to "tron:mainnet" for production (REAL FUNDS). USDT/USDD are registered
// for mainnet too (both permit2), so `tronAccepts()` works unchanged — only the
// client/facilitator TronWeb `fullHost` must point at a mainnet node.
export const TRON_NETWORK: `${string}:${string}` = "tron:nile";

/** TRON is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers the TRON `exact` server scheme.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerTron(resourceServer: x402ResourceServer): void {
  resourceServer.register(TRON_NETWORK, new ExactTronScheme());
}

/**
 * Builds the `accepts` entries advertised for TRON payments — USDT and USDD.
 *
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts() {
  const payTo = process.env.TRON_ADDRESS as string;
  return ["0.001 USDT", "0.001 USDD"].map(price => ({
    scheme: "exact",
    network: TRON_NETWORK,
    payTo,
    price,
  }));
}
