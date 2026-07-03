/**
 * TRON RPC resolution — builds a `TronWeb` instance for a CAIP-2 network.
 *
 * Centralizes the `tron:<name>` → fullHost mapping so the client/facilitator
 * factories take a `network` instead of a caller-built `TronWeb` (mirrors EVM's
 * `adapters/chains.ts`). Isolated in its own module so unit tests can `vi.mock`
 * it and inject a fake TronWeb without touching the network.
 */
import { TronWeb } from "tronweb";
import { log } from "@bankofai/x402-core";

/** CAIP-2 network → default TronGrid fullHost (used when an API key is supplied). */
const TRON_RPC: Record<string, string> = {
  "tron:0x2b6653dc": "https://api.trongrid.io",
  "tron:0x94a9059e": "https://api.shasta.trongrid.io",
  "tron:0xcd8690dc": "https://nile.trongrid.io",
};

/**
 * CAIP-2 network → fallback fullHost used when no TronGrid API key is supplied.
 *
 * The default TronGrid hosts rate-limit unkeyed traffic, so without a key the
 * default `nile.trongrid.io` quickly 429s. These endpoints work key-less. Mirrors
 * the Python/legacy `TRON_FALLBACK_RPC_URLS` (commit 8a893b8).
 */
const TRON_FALLBACK_RPC: Record<string, string> = {
  "tron:0x2b6653dc": "https://hptg.bankofai.io",
  // nileex is the official Nile endpoint and works without a TronGrid key
  // (the default nile.trongrid.io host gets rate-limited unkeyed).
  "tron:0xcd8690dc": "https://api.nileex.io",
  "tron:0x94a9059e": "https://api.shasta.trongrid.io",
};

/** Networks already warned about a missing API key (warn once per process). */
const warnedNetworks = new Set<string>();

/** Options for {@link buildTronWeb}. */
export interface BuildTronWebOptions {
  /** RPC fullHost override; falls back to the network's default. */
  rpcUrl?: string;
  /** TronGrid API key (sent as the `TRON-PRO-API-KEY` header) when set. */
  apiKey?: string;
}

/**
 * Resolve the fullHost for a CAIP-2 network.
 *
 * Precedence: explicit `rpcUrl` → keyed TronGrid default (when `apiKey` is set)
 * → key-less fallback endpoint → TronGrid default. Exported for unit testing.
 *
 * @param network - CAIP-2 id, e.g. `"tron:0xcd8690dc"`.
 * @param opts - Optional RPC override / API key.
 * @returns The resolved fullHost.
 * @throws When the network is unknown and no `rpcUrl` is supplied.
 */
export function resolveTronRpcUrl(network: string, opts: BuildTronWebOptions = {}): string {
  if (opts.rpcUrl) {
    return opts.rpcUrl;
  }
  if (!opts.apiKey) {
    const fallback = TRON_FALLBACK_RPC[network];
    if (fallback) {
      if (!warnedNetworks.has(network)) {
        warnedNetworks.add(network);
        log.warn(
          `[x402] No TronGrid API key for ${network}; routing RPC to fallback ${fallback}. ` +
            `Pass apiKey (e.g. from TRON_GRID_API_KEY) to use TronGrid.`,
        );
      }
      return fallback;
    }
  }
  const fullHost = TRON_RPC[network];
  if (!fullHost) {
    throw new Error(`No TRON RPC configured for network ${network}; pass rpcUrl.`);
  }
  return fullHost;
}

/**
 * Builds a `TronWeb` for a CAIP-2 network (contract reads + broadcast).
 *
 * @param network - CAIP-2 id, e.g. `"tron:0xcd8690dc"`.
 * @param opts - Optional RPC override / API key.
 * @returns A TronWeb instance.
 */
export function buildTronWeb(network: string, opts: BuildTronWebOptions = {}): TronWeb {
  const fullHost = resolveTronRpcUrl(network, opts);
  return new TronWeb({
    fullHost,
    ...(opts.apiKey ? { headers: { "TRON-PRO-API-KEY": opts.apiKey } } : {}),
  });
}
