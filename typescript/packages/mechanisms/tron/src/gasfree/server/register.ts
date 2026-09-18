import { x402ResourceServer } from "@bankofai/x402-core/server";
import { Network } from "@bankofai/x402-core/types";
import { normalizeTronNetwork } from "../../network";
import { ExactGasFreeTronScheme } from "./scheme";

/**
 * Configuration for registering the GasFree server scheme.
 */
export interface TronGasFreeResourceServerConfig {
  networks?: Network[];
}

/**
 * Register the TRON `exact_gasfree` server scheme on an x402ResourceServer.
 *
 * @param server - The x402ResourceServer instance.
 * @param config - The GasFree server configuration.
 * @returns The resource server instance.
 */
export function registerExactGasFreeTronScheme(
  server: x402ResourceServer,
  config: TronGasFreeResourceServerConfig = {},
): x402ResourceServer {
  if (config.networks && config.networks.length > 0) {
    config.networks.forEach(network =>
      server.register(normalizeTronNetwork(network) as Network, new ExactGasFreeTronScheme()),
    );
  } else {
    server.register("tron:*", new ExactGasFreeTronScheme());
  }

  return server;
}
