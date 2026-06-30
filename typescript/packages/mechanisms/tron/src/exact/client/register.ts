import { x402Client, PaymentPolicy } from "@bankofai/x402-core/client";
import { Network } from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { ExactTronScheme } from "./scheme";

/**
 * Configuration options for registering TRON exact schemes to an x402Client
 */
export interface ExactTronClientConfig {
  /** The TRON signer used to create payment payloads. */
  signer: ClientTronSigner;
  /** Specific networks to register; defaults to the `tron:*` wildcard. */
  networks?: Network[];
  /**
   * Optional policies to filter/transform payment requirements (applied via
   * `registerPolicy`). For token selection, pass a selector to the x402Client
   * constructor instead — the selector is a client-level setting.
   */
  policies?: PaymentPolicy[];
}

/**
 * Registers TRON exact payment scheme to an x402Client instance.
 *
 * @param client - The x402Client instance to register schemes to
 * @param config - Configuration for TRON client registration
 * @returns The client instance for chaining
 */
export function registerExactTronScheme(
  client: x402Client,
  config: ExactTronClientConfig,
): x402Client {
  const tronScheme = new ExactTronScheme(config.signer);

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      client.register(network, tronScheme);
    });
  } else {
    client.register("tron:*", tronScheme);
  }

  config.policies?.forEach(policy => client.registerPolicy(policy));

  return client;
}
