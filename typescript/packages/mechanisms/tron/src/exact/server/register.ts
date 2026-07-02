import { x402ResourceServer } from "@bankofai/x402-core/server";
import { Network } from "@bankofai/x402-core/types";
import { ExactTronScheme } from "./scheme";

/**
 * Configuration options for registering TRON schemes to an x402ResourceServer
 */
export interface TronResourceServerConfig {
  networks?: Network[];
}

/**
 * Registers TRON exact payment scheme to an x402ResourceServer instance.
 *
 * @param server - The x402 resource server instance.
 * @param config - The configuration for TRON resource server.
 * @returns The resource server instance.
 */
export function registerExactTronScheme(
  server: x402ResourceServer,
  config: TronResourceServerConfig = {},
): x402ResourceServer {
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      server.register(network, new ExactTronScheme());
    });
  } else {
    server.register("tron:*", new ExactTronScheme());
  }

  return server;
}
