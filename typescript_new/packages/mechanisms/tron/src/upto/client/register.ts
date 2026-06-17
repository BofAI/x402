import { x402Client, PaymentPolicy } from "@x402/core/client";
import { Network } from "@x402/core/types";
import { ClientTronSigner } from "../../signer";
import { UptoTronScheme } from "./scheme";

/**
 * Configuration options for registering the TRON upto scheme to an x402Client
 */
export interface UptoTronClientConfig {
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
 * Registers the TRON upto payment scheme to an x402Client instance.
 *
 * @param client - The x402Client instance to register schemes to
 * @param config - Configuration for TRON upto client registration
 * @returns The client instance for chaining
 */
export function registerUptoTronScheme(
  client: x402Client,
  config: UptoTronClientConfig,
): x402Client {
  const tronScheme = new UptoTronScheme(config.signer);

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
