import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { ExactTronFeeConfig } from "../../shared/fee";
import { ExactTronScheme } from "./scheme";

/**
 * Configuration options for registering TRON schemes to an x402Facilitator
 */
export interface TronFacilitatorConfig {
  signer: FacilitatorTronSigner;
  networks: Network | Network[];
  /** Optional facilitator fee configuration (advertised via getExtra). */
  fee?: ExactTronFeeConfig;
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
  facilitator.register(config.networks, new ExactTronScheme(config.signer, config.fee));
  return facilitator;
}
