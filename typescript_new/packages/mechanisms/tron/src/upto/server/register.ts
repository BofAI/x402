import { x402ResourceServer } from "@x402/core/server";
import { Network } from "@x402/core/types";
import { UptoTronScheme } from "./scheme";

/**
 * Configuration options for registering the TRON upto scheme to an x402ResourceServer
 */
export interface UptoTronResourceServerConfig {
  networks?: Network[];
}

/**
 * Registers the TRON upto payment scheme to an x402ResourceServer instance.
 *
 * @param server - The x402 resource server instance.
 * @param config - The configuration for TRON upto resource server.
 * @returns The resource server instance.
 */
export function registerUptoTronScheme(
  server: x402ResourceServer,
  config: UptoTronResourceServerConfig = {},
): x402ResourceServer {
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network => {
      server.register(network, new UptoTronScheme());
    });
  } else {
    server.register("tron:*", new UptoTronScheme());
  }

  return server;
}
