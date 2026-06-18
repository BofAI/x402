/**
 * TRON setup for the resource server — mirrors the EVM module. Keyless: just the
 * `exact` server scheme and an `accepts` entry with the TRON payout address.
 */
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

export const TRON_NETWORK = "tron:nile";

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
 * Builds the `accepts` entry advertised for TRON payments.
 *
 * @returns A payment-requirements accept entry.
 */
export function tronAccept() {
  return {
    scheme: "exact",
    price: "$0.001",
    network: TRON_NETWORK,
    payTo: process.env.TRON_ADDRESS as string,
  };
}
