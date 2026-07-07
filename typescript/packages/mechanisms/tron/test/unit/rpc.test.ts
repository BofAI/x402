import { describe, expect, it } from "vitest";
import { resolveTronRpcUrl } from "../../src/rpc";

/**
 * Offline unit tests for TRON RPC host resolution.
 *
 * Covers the key-less fallback added in the legacy tree (commit 8a893b8) and
 * ported here: without a TronGrid API key, nile/shasta/mainnet route to
 * unkeyed-friendly endpoints instead of the rate-limited TronGrid defaults.
 */

describe("resolveTronRpcUrl", () => {
  it("uses an explicit rpcUrl override above everything else", () => {
    expect(resolveTronRpcUrl("tron:0xcd8690dc", { rpcUrl: "https://my.host", apiKey: "k" })).toBe(
      "https://my.host",
    );
  });

  it("uses the keyed TronGrid default when an API key is supplied", () => {
    expect(resolveTronRpcUrl("tron:0xcd8690dc", { apiKey: "k" })).toBe("https://nile.trongrid.io");
    expect(resolveTronRpcUrl("tron:0x2b6653dc", { apiKey: "k" })).toBe("https://api.trongrid.io");
  });

  it("uses the key-less fallback for nile when no API key is set", () => {
    // nile.trongrid.io rate-limits unkeyed; nileex works key-less.
    expect(resolveTronRpcUrl("tron:0xcd8690dc")).toBe("https://api.nileex.io");
  });

  it("uses the key-less fallback for mainnet/shasta when no API key is set", () => {
    expect(resolveTronRpcUrl("tron:0x2b6653dc")).toBe("https://hptg.bankofai.io");
    expect(resolveTronRpcUrl("tron:0x94a9059e")).toBe("https://api.shasta.trongrid.io");
  });

  it("throws for an unknown network with no rpcUrl", () => {
    expect(() => resolveTronRpcUrl("tron:unknown")).toThrow(/No TRON RPC configured/);
  });
});
