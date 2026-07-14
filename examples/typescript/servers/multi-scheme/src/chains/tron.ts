/**
 * TRON setup for the multi-scheme resource server. Registers BOTH TRON schemes
 * on the same network so one server can accept `exact` (permit2, payer pays TRX
 * energy) and `exact_gasfree` (relayer pays energy, payer needs no TRX) payments
 * side by side. Keyless in both cases: only the payout address is advertised.
 *
 * The resource server keys registered schemes by `(network, scheme)`, so the two
 * schemes coexist on `TRON_NILE` without conflict — the client picks one via
 * the `accepts` entry it honors in the 402 challenge.
 */
import { TRON_NILE, TRON_MAINNET, TRON_SHASTA } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";
import { registerExactGasFreeTronScheme } from "@bankofai/x402-tron/gasfree/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

// Switch to TRON_MAINNET for production (REAL FUNDS); only the client and
// facilitator TronWeb/relayer endpoints change, this module is unchanged.
export const TRON_NETWORK: `${string}:${string}` = (process.env.TRON_NETWORK ??
  TRON_NILE) as `${string}:${string}`;

/** TRON is enabled when a payout address is configured. */
export function hasTron(): boolean {
  return !!process.env.TRON_ADDRESS;
}

/**
 * Registers both TRON server schemes:
 * - `exact` — permit2 transfer (USDT/USDD), payer broadcasts and pays energy.
 * - `exact_gasfree` — relayer pays energy from the payer's GasFree custodial wallet.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerTron(resourceServer: x402ResourceServer): void {
  resourceServer.register(TRON_NETWORK, new ExactTronScheme());
  registerExactGasFreeTronScheme(resourceServer, { networks: [TRON_NETWORK] });
}

/**
 * Builds the `accepts` entries advertised for TRON payments — USDT/USDD via
 * `exact`, plus USDT via `exact_gasfree`. The client chooses which scheme to pay.
 *
 * @returns Payment-requirements accept entries.
 */
export function tronAccepts() {
  const payTo = process.env.TRON_ADDRESS as string;
  return [
    // exact: permit2, payer pays TRX energy. USDT and USDD both resolve from the
    // scheme's token registry via the "<amount> <symbol>" price form.
    ...["0.001 USDT", "0.001 USDD"].map((price) => ({
      scheme: "exact" as const,
      network: TRON_NETWORK,
      payTo,
      price,
    })),
    // exact_gasfree: relayer pays energy; GasFree maps "$" to the network's
    // default asset (USDT). Funds come from the payer's GasFree custodial wallet.
    {
      scheme: "exact_gasfree" as const,
      network: TRON_NETWORK,
      payTo,
      price: "$0.001",
    },
  ];
}
