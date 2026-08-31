import { x402Client, PaymentPolicy } from "@bankofai/x402-core/client";
import { Network } from "@bankofai/x402-core/types";
import { normalizeTronNetwork } from "../../network";
import { ClientTronSigner } from "../../signer";
import { GasFreeAPIClient, createGasFreeApiClients } from "../../shared/gasfree/api";
import { GASFREE_API_BASE_URLS } from "../../shared/gasfree/config";
import { ExactGasFreeTronScheme } from "./scheme";

/**
 * GasFree register-time scheme options. Either pass ready-made `apiClients`, or
 * `apiBaseUrls` to build them (falling back to the built-in defaults).
 */
export interface ExactGasFreeTronSchemeOptions {
  /** GasFree relayer clients keyed by network. */
  apiClients?: Record<string, GasFreeAPIClient>;
  /** GasFree relayer base URLs keyed by network (used when apiClients omitted). */
  apiBaseUrls?: Record<string, string>;
}

/**
 * Configuration for registering the GasFree client scheme to an x402Client.
 *
 * For token selection, pass a selector to the {@link x402Client} constructor —
 * the selector is a client-level setting, not a per-scheme one.
 */
export interface ExactGasFreeTronClientConfig {
  /** The TRON signer used to create payment payloads. */
  signer: ClientTronSigner;
  /** Specific networks to register; defaults to the `tron:*` wildcard. */
  networks?: Network[];
  /** Optional policies to filter/transform payment requirements. */
  policies?: PaymentPolicy[];
  /** GasFree relayer wiring (clients or base URLs). */
  schemeOptions?: ExactGasFreeTronSchemeOptions;
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
  config: ExactGasFreeTronClientConfig,
): x402Client {
  const apiClients =
    config.schemeOptions?.apiClients ??
    createGasFreeApiClients(config.schemeOptions?.apiBaseUrls ?? GASFREE_API_BASE_URLS);
  const scheme = new ExactGasFreeTronScheme(config.signer, { apiClients });

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network =>
      client.register(normalizeTronNetwork(network) as Network, scheme),
    );
  } else {
    client.register("tron:*", scheme);
  }

  config.policies?.forEach(policy => client.registerPolicy(policy));

  return client;
}
