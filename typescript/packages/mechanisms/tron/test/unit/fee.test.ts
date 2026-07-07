import { describe, expect, it } from "vitest";
import {
  resolveBaseFee,
  isTokenAllowed,
  buildFeeInfo,
  readFeeFromExtra,
  type ExactTronFeeConfig,
} from "../../src/shared/fee";

/**
 * Offline unit tests for the TRON facilitator fee layer (F3).
 */

const NETWORK = "tron:0xcd8690dc";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const USDD = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK";
const FEE_TO = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

const config: ExactTronFeeConfig = {
  feeTo: FEE_TO,
  baseFee: { USDT: "10000", USDD: "1000000000000000000" },
};

describe("resolveBaseFee", () => {
  it("returns the configured base fee per symbol", () => {
    expect(resolveBaseFee(config, NETWORK, USDT)).toBe(10000n);
    expect(resolveBaseFee(config, NETWORK, USDD)).toBe(1000000000000000000n);
  });

  it("returns null when no baseFee map is configured", () => {
    expect(resolveBaseFee({}, NETWORK, USDT)).toBeNull();
  });

  it("returns null for unknown tokens or unconfigured symbols", () => {
    expect(resolveBaseFee(config, NETWORK, "TUnknown")).toBeNull();
    expect(resolveBaseFee({ baseFee: { USDT: "1" } }, NETWORK, USDD)).toBeNull();
  });
});

describe("isTokenAllowed", () => {
  it("allows all tokens when no allowlist is set", () => {
    expect(isTokenAllowed({}, USDT)).toBe(true);
  });

  it("enforces the allowlist case-insensitively", () => {
    const c: ExactTronFeeConfig = { allowedTokens: [USDT.toLowerCase()] };
    expect(isTokenAllowed(c, USDT)).toBe(true);
    expect(isTokenAllowed(c, USDD)).toBe(false);
  });
});

describe("buildFeeInfo", () => {
  it("builds fee terms for a configured token", () => {
    expect(buildFeeInfo(config, NETWORK, USDT, "TFallback")).toEqual({
      feeTo: FEE_TO,
      feeAmount: "10000",
    });
  });

  it("falls back to defaultFeeTo when config.feeTo is unset", () => {
    const c: ExactTronFeeConfig = { baseFee: { USDT: "5000" }, caller: "TCaller" };
    expect(buildFeeInfo(c, NETWORK, USDT, "TSigner")).toEqual({
      feeTo: "TSigner",
      feeAmount: "5000",
      caller: "TCaller",
    });
  });

  it("returns undefined for disallowed or unconfigured tokens", () => {
    expect(buildFeeInfo({ ...config, allowedTokens: [USDD] }, NETWORK, USDT, "T")).toBeUndefined();
    expect(buildFeeInfo({}, NETWORK, USDT, "T")).toBeUndefined();
  });
});


describe("readFeeFromExtra", () => {
  it("extracts a well-formed fee", () => {
    expect(readFeeFromExtra({ fee: { feeTo: FEE_TO, feeAmount: "100", caller: "TC" } })).toEqual({
      feeTo: FEE_TO,
      feeAmount: "100",
      caller: "TC",
    });
  });

  it("returns undefined for missing or malformed fee", () => {
    expect(readFeeFromExtra(undefined)).toBeUndefined();
    expect(readFeeFromExtra({})).toBeUndefined();
    expect(readFeeFromExtra({ fee: { feeTo: FEE_TO } })).toBeUndefined();
    expect(readFeeFromExtra({ fee: { feeAmount: "1" } })).toBeUndefined();
  });
});
