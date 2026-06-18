/**
 * EVM setup for the resource server. The server holds no key — it registers the
 * `exact` server scheme and declares an `accepts` entry (price + payTo). All
 * signing/settlement happens at the client and facilitator.
 */
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/server";
import type { x402ResourceServer } from "@bankofai/x402-express";

export const EVM_NETWORK = "eip155:84532"; // Base Sepolia

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `exact` server scheme.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerEvm(resourceServer: x402ResourceServer): void {
  resourceServer.register(EVM_NETWORK, new ExactEvmScheme());
}

/**
 * Builds the `accepts` entry advertised for EVM payments.
 *
 * @returns A payment-requirements accept entry.
 */
export function evmAccept() {
  return {
    scheme: "exact",
    price: "$0.001",
    network: EVM_NETWORK,
    payTo: process.env.EVM_ADDRESS as string,
  };
}
