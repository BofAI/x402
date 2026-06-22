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

// Switch to "tron:mainnet" for production (REAL FUNDS); only the client and
// facilitator TronWeb/relayer endpoints change, this module is unchanged.
export const TRON_NETWORK: `${string}:${string}` = "tron:nile";

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
 * Builds the `accepts` entries advertised for TRON GasFree payments (USDT).
 *
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts() {
  const payTo = process.env.TRON_ADDRESS as string;
  return ["0.001 USDT"].map(price => ({
    scheme: "exact_gasfree",
    network: TRON_NETWORK,
    payTo,
    price,
  }));
}
