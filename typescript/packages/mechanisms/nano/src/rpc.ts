import type { NanoBlockInfo, NanoRpcClient } from "./types";

/** Options for {@link createNanoRpcClient}. */
export interface CreateNanoRpcClientOptions {
  /** URL of a Nano node RPC endpoint (your own node or one you trust). */
  rpcUrl: string;
  /** Extra HTTP headers, e.g. an API key some public endpoints require. */
  headers?: Record<string, string>;
  /** Fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Largest response body read, in bytes. Defaults to 64 KiB. */
  maxResponseBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Refuse a cleartext (non-loopback) node URL: a network attacker could forge
 * the `block_info` reply that admits a payment.
 *
 * @param rpcUrl - The configured node URL.
 */
function assertSafeRpcUrl(rpcUrl: string): void {
  let url: URL;
  try {
    url = new URL(rpcUrl);
  } catch {
    throw new Error("Nano RPC URL is not a valid URL");
  }
  if (url.username || url.password) {
    throw new Error("Nano RPC URL must not embed credentials; use headers");
  }
  if (url.protocol === "https:") {
    return;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  if (url.protocol !== "http:" || !loopback) {
    throw new Error("Nano RPC URL must be https, or http on a loopback host");
  }
}

/**
 * Build a {@link NanoRpcClient} that talks JSON over HTTP to a Nano node.
 *
 * @param options - Endpoint and transport options.
 * @returns The RPC client.
 */
export function createNanoRpcClient(options: CreateNanoRpcClientOptions): NanoRpcClient {
  assertSafeRpcUrl(options.rpcUrl);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  return {
    async blockInfo(hash: string): Promise<NanoBlockInfo> {
      const response = await fetchImpl(options.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify({ action: "block_info", json_block: "true", hash }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`Nano RPC returned HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length > maxBytes) {
        throw new Error("Nano RPC response too large");
      }
      const body = JSON.parse(text) as Record<string, unknown>;
      if (typeof body.error === "string") {
        throw new Error(`Nano RPC error: ${body.error}`);
      }
      if (typeof body.block_account !== "string" || typeof body.contents !== "object") {
        throw new Error("Nano RPC returned a malformed block_info response");
      }
      return body as unknown as NanoBlockInfo;
    },
  };
}
