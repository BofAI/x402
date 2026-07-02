import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { Network } from "@bankofai/x402-core/types";
import { FacilitatorEvmSigner } from "../../signer";
import { ExactEvmScheme } from "./scheme";

/**
 * Configuration options for registering EVM schemes to an x402Facilitator
 */
export interface EvmFacilitatorConfig {
  /**
   * The EVM signer for facilitator operations (verify and settle)
   */
  signer: FacilitatorEvmSigner;

  /**
   * Networks to register (single network or array of networks)
   * Examples: "eip155:84532", ["eip155:84532", "eip155:1"]
   */
  networks: Network | Network[];

  /**
   * Allowlist of factory contract addresses (hex strings, case-insensitive) that the facilitator
   * will call when deploying an undeployed smart wallet via ERC-6492.
   *
   * A non-empty list enables ERC-4337 smart wallet deployment via EIP-6492. An empty or omitted
   * list denies all factory deployment calls (feature disabled by default).
   *
   * @default []
   */
  eip6492AllowedFactories?: string[];

  /**
   * If enabled, reruns on-chain simulation during settle's re-verify.
   *
   * @default false
   */
  simulateInSettle?: boolean;
}

/**
 * Registers EVM exact payment schemes to an x402Facilitator instance.
 *
 * This function registers:
 * - V2: Specified networks with ExactEvmScheme
 *
 * Note: legacy x402 v1 schemes are no longer auto-registered. The v1 classes
 * (`ExactEvmSchemeV1`, `NETWORKS`) are still exported under `@bankofai/x402-evm/v1`
 * and `@bankofai/x402-evm/exact/v1/*` for callers that explicitly need them.
 *
 * @param facilitator - The x402Facilitator instance to register schemes to
 * @param config - Configuration for EVM facilitator registration
 * @returns The facilitator instance for chaining
 *
 * @example
 * ```typescript
 * import { registerExactEvmScheme } from "@bankofai/x402-evm/exact/facilitator/register";
 * import { x402Facilitator } from "@bankofai/x402-core/facilitator";
 * import { createPublicClient, createWalletClient } from "viem";
 *
 * const facilitator = new x402Facilitator();
 *
 * // Single network
 * registerExactEvmScheme(facilitator, {
 *   signer: combinedClient,
 *   networks: "eip155:84532"  // Base Sepolia
 * });
 *
 * // Multiple networks (will auto-derive eip155:* pattern)
 * registerExactEvmScheme(facilitator, {
 *   signer: combinedClient,
 *   networks: ["eip155:84532", "eip155:1"]  // Base Sepolia and Mainnet
 * });
 * ```
 */
export function registerExactEvmScheme(
  facilitator: x402Facilitator,
  config: EvmFacilitatorConfig,
): x402Facilitator {
  // Register V2 scheme with specified networks
  facilitator.register(
    config.networks,
    new ExactEvmScheme(config.signer, {
      eip6492AllowedFactories: config.eip6492AllowedFactories,
      simulateInSettle: config.simulateInSettle,
    }),
  );

  return facilitator;
}
