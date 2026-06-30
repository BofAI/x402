import { describe, expect, it } from "vitest";
import {
  getToken,
  findByAddress,
  getNetworkTokens,
  registerToken,
  getDecimals,
  buildAssetExtra,
  parsePrice,
} from "../../src/shared/tokens";

/**
 * Offline unit tests for the TRON token registry (F2).
 *
 * Covers lookup, decimals resolution, AssetAmount extra construction, and
 * BigInt-safe price parsing with precision-overflow rejection.
 */

const USDT_NILE = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const USDD_NILE = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK";

describe("token registry lookups", () => {
  it("resolves tokens by symbol case-insensitively", () => {
    expect(getToken("tron:nile", "usdt")?.address).toBe(USDT_NILE);
    expect(getToken("tron:nile", "USDT")?.decimals).toBe(6);
    expect(getToken("tron:nile", "USDD")?.decimals).toBe(18);
  });

  it("resolves tokens by address case-insensitively", () => {
    expect(findByAddress("tron:nile", USDT_NILE.toLowerCase())?.symbol).toBe("USDT");
    expect(findByAddress("tron:nile", USDD_NILE)?.symbol).toBe("USDD");
  });

  it("returns undefined for unknown network/token", () => {
    expect(getToken("tron:unknown", "USDT")).toBeUndefined();
    expect(findByAddress("tron:nile", "TNotARealAddress")).toBeUndefined();
  });

  it("lists all tokens for a network", () => {
    const tokens = getNetworkTokens("tron:nile");
    expect(Object.keys(tokens).sort()).toEqual(["USDD", "USDT"]);
    expect(getNetworkTokens("tron:unknown")).toEqual({});
  });

  it("mainnet and nile USDT default to permit2, shasta USDT does not", () => {
    expect(getToken("tron:mainnet", "USDT")?.assetTransferMethod).toBe("permit2");
    expect(getToken("tron:nile", "USDT")?.assetTransferMethod).toBe("permit2");
    expect(getToken("tron:shasta", "USDT")?.assetTransferMethod).toBeUndefined();
  });
});

describe("getDecimals", () => {
  it("returns token decimals when registered", () => {
    expect(getDecimals("tron:nile", USDT_NILE)).toBe(6);
    expect(getDecimals("tron:nile", USDD_NILE)).toBe(18);
  });

  it("falls back to 6 for unknown assets", () => {
    expect(getDecimals("tron:nile", "TUnknown")).toBe(6);
  });
});

describe("buildAssetExtra", () => {
  it("omits name/version for plain permit2 tokens but keeps assetTransferMethod", () => {
    const usdt = getToken("tron:nile", "USDT")!;
    const extra = buildAssetExtra(usdt);
    expect(extra).toEqual({ assetTransferMethod: "permit2" });
  });

  it("includes name/version for eip3009 tokens (no transfer method)", () => {
    const shasta = getToken("tron:shasta", "USDT")!;
    const extra = buildAssetExtra(shasta);
    expect(extra).toEqual({ name: "Tether USD", version: "1" });
  });

  it("includes name/version for eip2612-capable permit2 tokens", () => {
    const extra = buildAssetExtra({
      address: "TFoo",
      decimals: 6,
      name: "Foo",
      symbol: "FOO",
      version: "2",
      assetTransferMethod: "permit2",
      supportsEip2612: true,
    });
    expect(extra).toEqual({
      name: "Foo",
      version: "2",
      assetTransferMethod: "permit2",
    });
  });
});

describe("parsePrice", () => {
  it("converts whole and fractional amounts to smallest units", () => {
    expect(parsePrice("1 USDT", "tron:nile")).toEqual({
      asset: USDT_NILE,
      amount: "1000000",
      extra: { assetTransferMethod: "permit2" },
    });
    expect(parsePrice("1.25 USDT", "tron:nile").amount).toBe("1250000");
    expect(parsePrice("0.000001 USDT", "tron:nile").amount).toBe("1");
  });

  it("handles 18-decimal tokens with BigInt-safe conversion", () => {
    expect(parsePrice("1 USDD", "tron:nile").amount).toBe("1000000000000000000");
    expect(parsePrice("0.5 USDD", "tron:nile").amount).toBe("500000000000000000");
  });

  it("is whitespace-tolerant and symbol case-insensitive", () => {
    expect(parsePrice("  2.5   usdt ".trim(), "tron:nile").amount).toBe("2500000");
  });

  it("rejects malformed price formats", () => {
    expect(() => parsePrice("1USDT", "tron:nile")).toThrow(/Expected/);
    expect(() => parsePrice("USDT", "tron:nile")).toThrow(/Expected/);
    expect(() => parsePrice("-1 USDT", "tron:nile")).toThrow(/non-negative decimal/);
  });

  it("rejects unknown tokens", () => {
    expect(() => parsePrice("1 WBTC", "tron:nile")).toThrow(/Unknown token/);
  });

  it("rejects precision overflow", () => {
    expect(() => parsePrice("1.1234567 USDT", "tron:nile")).toThrow(/more decimal places/);
  });

  it("supports runtime-registered tokens", () => {
    registerToken("tron:nile", {
      address: "TTestTokenAddress0000000000000000000",
      decimals: 2,
      name: "Test",
      symbol: "TEST",
      version: "1",
    });
    expect(parsePrice("3.21 TEST", "tron:nile")).toEqual({
      asset: "TTestTokenAddress0000000000000000000",
      amount: "321",
      extra: { name: "Test", version: "1" },
    });
  });
});
