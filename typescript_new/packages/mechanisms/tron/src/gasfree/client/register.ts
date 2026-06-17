import { x402Client } from "@x402/core/client";
import { Network } from "@x402/core/types";
import { ClientTronSigner } from "../../signer";
import { GasFreeAPIClient, createGasFreeApiClients } from "../../shared/gasfree/api";
import { GASFREE_API_BASE_URLS } from "../../shared/gasfree/config";
import { ExactGasFreeScheme } from "./scheme";

/**
 * Configuration for registering the GasFree client scheme to an x402Client.
 */
export interface TronGasFreeClientConfig {
  signer: ClientTronSigner;
  networks?: Network[];
  /** GasFree relayer clients keyed by network. */
  apiClients?: Record<string, GasFreeAPIClient>;
  /** GasFree relayer base URLs keyed by network (used when apiClients omitted). */
  apiBaseUrls?: Record<string, string>;
}

/**
 * Register the TRON `exact_gasfree` client scheme on an x402Client.
 *
 * @param client - The x402Client instance.
 * @param config - The GasFree client configuration.
 * @returns The client instance for chaining.
 */
export function registerExactGasFreeTronScheme(
  client: x402Client,
  config: TronGasFreeClientConfig,
): x402Client {
  const apiClients =
    config.apiClients ?? createGasFreeApiClients(config.apiBaseUrls ?? GASFREE_API_BASE_URLS);
  const scheme = new ExactGasFreeScheme(config.signer, apiClients);

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => client.register(network, scheme));
  } else {
    client.register("tron:*", scheme);
  }

  return client;
}
