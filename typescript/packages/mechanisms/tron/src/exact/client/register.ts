import { x402Client } from "@bankofai/x402-core/client";
import { Network } from "@bankofai/x402-core/types";
import { ClientTronSigner } from "../../signer";
import { ExactTronScheme } from "./scheme";

/**
 * Configuration options for registering TRON exact schemes to an x402Client
 */
export interface TronClientConfig {
  signer: ClientTronSigner;
  networks?: Network[];
}

/**
 * Registers TRON exact payment scheme to an x402Client instance.
 *
 * @param client - The x402Client instance to register schemes to
 * @param config - Configuration for TRON client registration
 * @returns The client instance for chaining
 */
export function registerExactTronScheme(client: x402Client, config: TronClientConfig): x402Client {
  const tronScheme = new ExactTronScheme(config.signer);

  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      client.register(network, tronScheme);
    });
  } else {
    client.register("tron:*", tronScheme);
  }

  return client;
}
