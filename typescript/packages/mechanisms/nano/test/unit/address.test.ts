import { describe, expect, it } from "vitest";
import {
  decodeNanoAddress,
  encodeNanoAddress,
  isNanoAddress,
  nanoAddressToPublicKey,
  nanoAddressesEqual,
} from "../../src";
import { PAY_TO, PAY_TO_KEY } from "./helpers";

const hexToBytes = (hex: string) =>
  Uint8Array.from((hex.match(/../g) ?? []).map(byte => parseInt(byte, 16)));

describe("Nano addresses", () => {
  it.each([
    [
      "0000000000000000000000000000000000000000000000000000000000000000",
      "nano_1111111111111111111111111111111111111111111111111111hifc8npp",
    ],
    [
      "E89208DD038FBB269987689621D52292AE9C35941A7484756ECCED92A65093BA",
      "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3",
    ],
    [PAY_TO_KEY, PAY_TO],
  ])("encodes public key %s as %s and back", (key, address) => {
    expect(encodeNanoAddress(hexToBytes(key))).toBe(address);
    expect(nanoAddressToPublicKey(address)).toBe(key);
  });

  it("accepts the legacy xrb_ prefix for the same account", () => {
    const legacy = PAY_TO.replace("nano_", "xrb_");
    expect(isNanoAddress(legacy)).toBe(true);
    expect(nanoAddressesEqual(legacy, PAY_TO)).toBe(true);
  });

  it("rejects a single changed checksum character", () => {
    const broken = PAY_TO.slice(0, -1) + (PAY_TO.endsWith("z") ? "y" : "z");
    expect(isNanoAddress(broken)).toBe(false);
    expect(() => decodeNanoAddress(broken)).toThrow(/checksum/);
  });

  it("rejects a changed key character", () => {
    const broken = PAY_TO.slice(0, 10) + (PAY_TO[10] === "1" ? "3" : "1") + PAY_TO.slice(11);
    expect(isNanoAddress(broken)).toBe(false);
  });

  it.each([
    "",
    "nano_",
    PAY_TO.slice(0, -1),
    PAY_TO + "1",
    PAY_TO.toUpperCase(),
    PAY_TO.replace("nano_", "ban_"),
    "nano_" + "2".repeat(60),
    "nano_" + "4" + PAY_TO.slice(6),
  ])("rejects malformed address %s", address => {
    expect(isNanoAddress(address)).toBe(false);
  });

  it("does not treat invalid addresses as equal", () => {
    expect(nanoAddressesEqual("nano_x", "nano_x")).toBe(false);
  });
});
