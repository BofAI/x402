import { describe, expect, it } from "vitest";
import {
  resolveBaseFee,
  isTokenAllowed,
  buildFeeInfo,
  validateFee,
  readFeeFromExtra,
  FEE_TOKEN_NOT_ALLOWED,
  FEE_UNSUPPORTED_TOKEN,
  FEE_AMOUNT_TOO_LOW,
  FEE_TO_MISMATCH,
  type ExactTronFeeConfig,
} from "../../src/shared/fee";

/**
 * Offline unit tests for the TRON facilitator fee layer (F3).
 */

const NETWORK = "tron:nile";
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

describe("validateFee", () => {
  it("accepts a fee meeting or exceeding the base fee", () => {
    expect(validateFee(config, NETWORK, USDT, { feeTo: FEE_TO, feeAmount: "10000" })).toBeNull();
    expect(validateFee(config, NETWORK, USDT, { feeTo: FEE_TO, feeAmount: "20000" })).toBeNull();
  });

  it("rejects a fee below the base fee", () => {
    expect(validateFee(config, NETWORK, USDT, { feeTo: FEE_TO, feeAmount: "9999" })).toBe(
      FEE_AMOUNT_TOO_LOW,
    );
  });

  it("rejects a mismatched feeTo", () => {
    expect(validateFee(config, NETWORK, USDT, { feeTo: "TWrong", feeAmount: "10000" })).toBe(
      FEE_TO_MISMATCH,
    );
  });

  it("rejects disallowed tokens and unsupported tokens", () => {
    const allowOnlyUsdd: ExactTronFeeConfig = { ...config, allowedTokens: [USDD] };
    expect(validateFee(allowOnlyUsdd, NETWORK, USDT, { feeTo: FEE_TO, feeAmount: "10000" })).toBe(
      FEE_TOKEN_NOT_ALLOWED,
    );
    expect(validateFee(config, NETWORK, "TUnknown", { feeTo: FEE_TO, feeAmount: "1" })).toBe(
      FEE_UNSUPPORTED_TOKEN,
    );
  });

  it("uses a custom normalizer for feeTo comparison", () => {
    const norm = (a: string) => a.toUpperCase();
    expect(
      validateFee(config, NETWORK, USDT, { feeTo: FEE_TO.toLowerCase(), feeAmount: "10000" }, norm),
    ).toBeNull();
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
