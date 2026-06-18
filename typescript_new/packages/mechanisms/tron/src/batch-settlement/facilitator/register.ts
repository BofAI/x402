import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { Network } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import type { TronAuthorizerSigner } from "../types";
import { BatchSettlementTronScheme } from "./scheme";

/**
 * Configuration for registering the batch-settlement facilitator scheme.
 */
export interface TronBatchSettlementFacilitatorConfig {
  signer: FacilitatorTronSigner;
  /** Receiver-authorizer key that signs claim/refund digests when the server omits them. */
  authorizerSigner: TronAuthorizerSigner;
  networks: Network | Network[];
}

/**
 * Registers the TRON `batch-settlement` facilitator scheme on an x402Facilitator.
 *
 * @param facilitator - The x402 facilitator instance.
 * @param config - The batch-settlement facilitator configuration.
 * @returns The facilitator instance for chaining.
 */
export function registerBatchSettlementTronFacilitatorScheme(
  facilitator: x402Facilitator,
  config: TronBatchSettlementFacilitatorConfig,
): x402Facilitator {
  facilitator.register(
    config.networks,
    new BatchSettlementTronScheme(config.signer, config.authorizerSigner),
  );
  return facilitator;
}
