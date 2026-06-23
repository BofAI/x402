/**
 * TRON RPC resolution — builds a `TronWeb` instance for a CAIP-2 network.
 *
 * Centralizes the `tron:<name>` → fullHost mapping so the client/facilitator
 * factories take a `network` instead of a caller-built `TronWeb` (mirrors EVM's
 * `adapters/chains.ts`). Isolated in its own module so unit tests can `vi.mock`
 * it and inject a fake TronWeb without touching the network.
 */
import { TronWeb } from "tronweb";

/** CAIP-2 network → default TronGrid fullHost. */
const TRON_RPC: Record<string, string> = {
  "tron:mainnet": "https://api.trongrid.io",
  "tron:shasta": "https://api.shasta.trongrid.io",
  "tron:nile": "https://nile.trongrid.io",
};

/** Options for {@link buildTronWeb}. */
export interface BuildTronWebOptions {
  /** RPC fullHost override; falls back to the network's default. */
  rpcUrl?: string;
  /** TronGrid API key (sent as the `TRON-PRO-API-KEY` header) when set. */
  apiKey?: string;
}

/**
 * Builds a key-less `TronWeb` for a CAIP-2 network (contract reads + broadcast).
 *
 * @param network - CAIP-2 id, e.g. `"tron:nile"`.
 * @param opts - Optional RPC override / API key.
 * @returns A TronWeb instance.
 */
export function buildTronWeb(network: string, opts: BuildTronWebOptions = {}): TronWeb {
  const fullHost = opts.rpcUrl ?? TRON_RPC[network];
  if (!fullHost) {
    throw new Error(`No TRON RPC configured for network ${network}; pass rpcUrl.`);
  }
  return new TronWeb({
    fullHost,
    ...(opts.apiKey ? { headers: { "TRON-PRO-API-KEY": opts.apiKey } } : {}),
  });
}
