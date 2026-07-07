/**
 * TRON GasFree setup for the resource server (scheme `exact_gasfree`). Keyless,
 * like the `exact` module: register the server scheme and advertise `accepts`
 * with the TRON payout address. Funds settle from the payer's GasFree custodial
 * wallet via a relayer; the server only needs the payout address.
 *
 * GasFree is TRON-only — there is no EVM counterpart.
 */
import { registerExactGasFreeTronScheme } from "@bankofai/x402-tron/gasfree/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

// Switch to "tron:0x2b6653dc" for production (REAL FUNDS); only the client and
// facilitator TronWeb/relayer endpoints change, this module is unchanged.
export const TRON_NETWORK: `${string}:${string}` = "tron:0xcd8690dc";

/** TRON GasFree is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers the TRON `exact_gasfree` server scheme.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerTron(resourceServer: x402ResourceServer): void {
  registerExactGasFreeTronScheme(resourceServer, { networks: [TRON_NETWORK] });
}

/**
 * Builds the `accepts` entries advertised for TRON GasFree payments — USDT,
 * priced in `"$"` form (the scheme maps it to the network's default asset, USDT).
 *
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts() {
  const payTo = process.env.TRON_ADDRESS as string;
  return [{ scheme: "exact_gasfree", network: TRON_NETWORK, payTo, price: "$0.001" }];
}
