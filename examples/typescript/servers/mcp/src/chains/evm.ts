/**
 * EVM (BSC testnet) setup for the MCP resource server. Keyless: register the
 * `exact` server scheme on `eip155:97` and declare the `accepts` (price + payTo).
 * Signing/settlement happen at the client + facilitator.
 *
 * This demo advertises only DHLU — an **ERC-3009** token, so payment is gasless
 * with no `approve` step and no gas-sponsoring extension. To also accept a plain
 * BEP-20 token (e.g. BSC USDC, permit2 + a one-time approve) you would declare
 * the ERC-20 approval gas-sponsoring extension — see `servers/express`.
 */
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/server";
import type { Network } from "@bankofai/x402-core/types";
import type { ResourceConfig, x402ResourceServer } from "@bankofai/x402-core/server";

/** CAIP-2 network this server accepts EVM payments on (BSC testnet). */
export const EVM_NETWORK: Network = "eip155:97";

/** DHLU (6 dec, ERC-3009) on BSC testnet — gasless, domain verified on-chain. */
const DHLU = {
  asset: "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
  amount: "1000", // 0.001 × 1e6
  extra: { name: "DA HULU", version: "1" },
};

/** EVM is enabled when a payout address is configured. */
export function hasEvm(): boolean {
  return !!process.env.EVM_ADDRESS;
}

/**
 * Registers the EVM `exact` server scheme on `eip155:97`.
 *
 * @param resourceServer - The resource server to register on.
 */
export function registerEvm(resourceServer: x402ResourceServer): void {
  resourceServer.register(EVM_NETWORK, new ExactEvmScheme());
}

/**
 * Builds the resource config advertised for EVM payments (one token).
 *
 * @returns A single-element array of resource configs for buildPaymentRequirements.
 */
export function evmAccepts(): ResourceConfig[] {
  const payTo = process.env.EVM_ADDRESS as string;
  return [
    {
      scheme: "exact",
      network: EVM_NETWORK,
      payTo,
      price: { amount: DHLU.amount, asset: DHLU.asset, extra: DHLU.extra },
    } as ResourceConfig,
  ];
}
