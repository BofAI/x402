/**
 * TRON setup for the upto resource server — mirrors the EVM module.
 *
 * Key-less: registers the `upto` server scheme and advertises `accepts`. The
 * actual charge is decided per request in `index.ts` via a `Settlement-Overrides`
 * response header.
 *
 * `tron:0xcd8690dc` USDT is in the default-asset registry, so the price is given in
 * `"$"` form (the scheme maps it to USDT). USDT is a **Permit2** token, so the
 * client authorizes via Permit2 — the payer needs a one-time `approve(Permit2)`.
 */
import { UptoTronScheme } from "@bankofai/x402-tron/upto/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

// Switch to "tron:0x2b6653dc" for production (REAL FUNDS): USDT is registered there
// too — only the facilitator/client TronWeb `fullHost` must point at mainnet.
export const TRON_NETWORK: `${string}:${string}` = "tron:0xcd8690dc";

/** TRON is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers the TRON `upto` server scheme.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerTron(resourceServer: x402ResourceServer): void {
  const payTo = process.env.TRON_ADDRESS as string;
  resourceServer.register(TRON_NETWORK, new UptoTronScheme());
  console.info(`[tron] server registered ${TRON_NETWORK} upto (payTo ${payTo})`);
}

/**
 * Builds the `accepts` entries advertised for TRON upto payments — USDT, priced
 * at the authorization ceiling in `"$"` form.
 *
 * @param price - The authorization ceiling (e.g. `"$0.10"`).
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts(price: string) {
  const payTo = process.env.TRON_ADDRESS as string;
  return [{ scheme: "upto", network: TRON_NETWORK, payTo, price }];
}
