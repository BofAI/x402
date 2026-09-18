import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { Network } from "@bankofai/x402-core/types";
import { normalizeTronNetwork } from "../../network";
import { FacilitatorTronSigner } from "../../signer";
import { GasFreeAPIClient, createGasFreeApiClients } from "../../shared/gasfree/api";
import { GASFREE_API_BASE_URLS } from "../../shared/gasfree/config";
import { ExactGasFreeTronScheme } from "./scheme";

/**
 * Configuration for registering the GasFree facilitator scheme.
 */
export interface TronGasFreeFacilitatorConfig {
  signer: FacilitatorTronSigner;
  networks: Network | Network[];
  /** GasFree relayer clients keyed by network. */
  apiClients?: Record<string, GasFreeAPIClient>;
  /** GasFree relayer base URLs keyed by network (used when apiClients omitted). */
  apiBaseUrls?: Record<string, string>;
}

/**
 * Register the TRON `exact_gasfree` facilitator scheme on an x402Facilitator.
 *
 * @param facilitator - The x402Facilitator instance.
 * @param config - The GasFree facilitator configuration.
 * @returns The facilitator instance.
 */
export function registerExactGasFreeTronScheme(
  facilitator: x402Facilitator,
  config: TronGasFreeFacilitatorConfig,
): x402Facilitator {
  const apiClients =
    config.apiClients ?? createGasFreeApiClients(config.apiBaseUrls ?? GASFREE_API_BASE_URLS);
  const networks = (Array.isArray(config.networks) ? config.networks : [config.networks]).map(
    network => normalizeTronNetwork(network) as Network,
  );
  facilitator.register(
    [...new Set(networks)],
    new ExactGasFreeTronScheme(config.signer, apiClients),
  );
  return facilitator;
}
