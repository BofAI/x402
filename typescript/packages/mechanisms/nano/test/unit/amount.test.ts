import { describe, expect, it } from "vitest";
import { MAX_RAW, RAW_PER_XNO, parseRaw, rawToXno, xnoToRaw } from "../../src";

describe("XNO amounts", () => {
  it("uses 10^30 raw per XNO", () => {
    expect(RAW_PER_XNO).toBe(10n ** 30n);
    expect(xnoToRaw("1")).toBe(RAW_PER_XNO);
  });

  it.each([
    ["0.001", 10n ** 27n],
    ["0.0005", 5n * 10n ** 26n],
    ["0.000000000000000000000000000001", 1n],
    ["340282366.920938463463374607431768211455", MAX_RAW],
  ])("converts %s XNO to raw exactly", (xno, raw) => {
    expect(xnoToRaw(xno)).toBe(raw);
    expect(rawToXno(raw)).toBe(xno);
  });

  it("refuses a 31st decimal instead of rounding", () => {
    expect(() => xnoToRaw("0.0000000000000000000000000000001")).toThrow(/more than 30 decimals/);
  });

  it.each(["1e-3", "1E3", "-1", "+1", ".5", "1.", " 1", "1,5", "0x10", ""])("refuses %s", value => {
    expect(() => xnoToRaw(value)).toThrow();
  });

  it("refuses JavaScript numbers", () => {
    expect(() => xnoToRaw(0.1 as unknown as string)).toThrow(/string/);
  });

  it("refuses amounts above the supply ceiling", () => {
    expect(() => xnoToRaw("340282366.920938463463374607431768211456")).toThrow(/2\^128/);
    expect(() => parseRaw((MAX_RAW + 1n).toString())).toThrow(/2\^128/);
  });

  it.each(["01", "-1", "1.0", "1e30", " 1", ""])("parseRaw refuses %s", value => {
    expect(() => parseRaw(value)).toThrow();
  });

  it("parseRaw accepts plain integers", () => {
    expect(parseRaw("0")).toBe(0n);
    expect(parseRaw("1000000000000000000000000000000")).toBe(RAW_PER_XNO);
  });
});
