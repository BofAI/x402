import { x402Facilitator } from "@x402/core/facilitator";
import { Network } from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { ExactTronFeeConfig } from "../../shared/fee";
import { UptoTronScheme } from "./scheme";

/**
 * Configuration options for registering the TRON upto scheme to an x402Facilitator
 */
export interface UptoTronFacilitatorConfig {
  signer: FacilitatorTronSigner;
  networks: Network | Network[];
  /** Optional facilitator fee configuration (advertised via getExtra). */
  fee?: ExactTronFeeConfig;
}

/**
 * Registers the TRON upto payment scheme to an x402Facilitator instance.
 *
 * @param facilitator - The x402 facilitator instance.
 * @param config - The configuration for TRON upto facilitator.
 * @returns The facilitator instance.
 */
export function registerUptoTronScheme(
  facilitator: x402Facilitator,
  config: UptoTronFacilitatorConfig,
): x402Facilitator {
  facilitator.register(config.networks, new UptoTronScheme(config.signer, config.fee));
  return facilitator;
}
