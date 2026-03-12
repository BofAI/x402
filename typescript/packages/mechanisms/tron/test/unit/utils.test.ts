import { describe, expect, it } from "vitest";
import { evmAddressToTron, normalizeAddressForSigning, tronAddressToEvm } from "../../src/utils";

describe("TRON address utils", () => {
  const evmAddress = "0x1111111111111111111111111111111111111111" as const;
  const tronAddress = evmAddressToTron(evmAddress);

  it("converts a Base58Check TRON address to EVM hex", () => {
    expect(tronAddressToEvm(tronAddress)).toBe(evmAddress);
  });

  it("normalizes Base58Check TRON addresses for signing", () => {
    expect(normalizeAddressForSigning(tronAddress)).toBe(evmAddress);
  });

  it("accepts 41-prefixed TRON hex addresses", () => {
    expect(tronAddressToEvm(`41${evmAddress.slice(2)}`)).toBe(evmAddress);
  });

  it("rejects TRON addresses with invalid checksum", () => {
    const invalid = `${tronAddress.slice(0, -1)}${tronAddress.endsWith("1") ? "2" : "1"}`;
    expect(() => tronAddressToEvm(invalid)).toThrow();
  });

  it("rejects invalid Base58 characters", () => {
    expect(() => tronAddressToEvm("T0invalidAddress")).toThrow();
  });
});
