import type { NanoBlockInfo, NanoRpcClient } from "./types";

/** Options for {@link createNanoRpcClient}. */
export interface CreateNanoRpcClientOptions {
  /** URL of a Nano node RPC endpoint (your own node or one you trust). */
  rpcUrl: string;
  /** Extra HTTP headers, e.g. an API key some public endpoints require. */
  headers?: Record<string, string>;
  /** Fetch implementation; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * Build a {@link NanoRpcClient} that talks JSON over HTTP to a Nano node.
 *
 * @param options - Endpoint and transport options.
 * @returns The RPC client.
 */
export function createNanoRpcClient(options: CreateNanoRpcClientOptions): NanoRpcClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async blockInfo(hash: string): Promise<NanoBlockInfo> {
      const response = await fetchImpl(options.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body: JSON.stringify({ action: "block_info", json_block: "true", hash }),
      });
      if (!response.ok) {
        throw new Error(`Nano RPC returned HTTP ${response.status}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
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
