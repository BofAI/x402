import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { Network } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { ExactTronScheme } from "./scheme";

/**
 * Configuration options for registering TRON schemes to an x402Facilitator
 */
export interface TronFacilitatorConfig {
  signer: FacilitatorTronSigner;
  networks: Network | Network[];
}

/**
 * Registers TRON exact payment scheme to an x402Facilitator instance.
 *
 * @param facilitator - The x402 facilitator instance.
 * @param config - The configuration for TRON facilitator.
 * @returns The facilitator instance.
 */
export function registerExactTronScheme(
  facilitator: x402Facilitator,
  config: TronFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new ExactTronScheme(config.signer));
  return facilitator;
}
