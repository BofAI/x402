import { x402Client, PaymentPolicy } from "@bankofai/x402-core/client";
import { Network } from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { BatchSettlementTronScheme } from "./scheme";
import type { BatchSettlementTronSchemeOptions } from "./config";
import type { BatchSettlementDepositPolicy } from "./config";

/**
 * Configuration for registering the batch-settlement client scheme to an x402Client.
 *
 * For token selection, pass a selector to the {@link x402Client} constructor —
 * the selector is a client-level setting, not a per-scheme one.
 */
export interface BatchSettlementTronClientConfig {
  /** The TRON signer used to create payment payloads. */
  signer: ClientTronSigner;
  /** Specific networks to register; defaults to the `tron:*` wildcard. */
  networks?: Network[];
  /** Optional policies to filter/transform payment requirements. */
  policies?: PaymentPolicy[];
  /**
   * Scheme options, or — as a convenience — a bare deposit policy
   * (resolved by the scheme via `resolveClientOptions`).
   */
  schemeOptions?: BatchSettlementTronSchemeOptions | BatchSettlementDepositPolicy;
}

/**
 * Register the TRON `batch-settlement` client scheme on an x402Client.
 *
 * @param client - The x402Client instance.
 * @param config - The batch-settlement client configuration.
 * @returns The client instance for chaining.
 */
export function registerBatchSettlementTronScheme(
  client: x402Client,
  config: BatchSettlementTronClientConfig,
): x402Client {
  const scheme = new BatchSettlementTronScheme(config.signer, config.schemeOptions);
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => client.register(network, scheme));
  } else {
    client.register("tron:*", scheme);
  }
  config.policies?.forEach(policy => client.registerPolicy(policy));
  return client;
}
