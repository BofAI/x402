import { describe, expect, it, vi } from "vitest";
import { createNanoRpcClient } from "../../src";
import { BLOCK_HASH } from "./helpers";

describe("createNanoRpcClient", () => {
  it("accepts https and loopback http node URLs", () => {
    for (const rpcUrl of [
      "https://node.example.com/rpc",
      "http://127.0.0.1:7076",
      "http://localhost:7076",
      "http://[::1]:7076",
    ]) {
      expect(() => createNanoRpcClient({ rpcUrl })).not.toThrow();
    }
  });

  it("refuses cleartext non-loopback and credential-bearing node URLs", () => {
    for (const rpcUrl of [
      "http://node.example.com/rpc",
      "http://10.0.0.5:7076",
      "http://127.0.0.1@evil.example/rpc",
      "ftp://127.0.0.1",
      "not a url",
    ]) {
      expect(() => createNanoRpcClient({ rpcUrl })).toThrow();
    }
  });

  it("sends a timeout signal and refuses an oversized response", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("x".repeat(70_000), { status: 200 }),
    );
    const rpc = createNanoRpcClient({
      rpcUrl: "http://127.0.0.1:7076",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(rpc.blockInfo(BLOCK_HASH)).rejects.toThrow("too large");
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
