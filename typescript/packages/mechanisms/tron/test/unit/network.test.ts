import { describe, expect, it } from "vitest";
import {
  PERMIT2_ADDRESSES,
  TRON_CHAIN_IDS,
  TRON_MAINNET,
  TRON_NILE,
  TRON_SHASTA,
  getTronNetworkValue,
  normalizeTronNetwork,
  tronNetworksEqual,
} from "../../src";

describe("TRON CAIP-2 network identifiers", () => {
  it("exports decimal identifiers as canonical constants", () => {
    expect(TRON_MAINNET).toBe("tron:728126428");
    expect(TRON_NILE).toBe("tron:3448148188");
    expect(TRON_SHASTA).toBe("tron:2494104990");
  });

  it.each([
    ["tron:0x2b6653dc", TRON_MAINNET],
    ["tron:0xcd8690dc", TRON_NILE],
    ["tron:0x94a9059e", TRON_SHASTA],
    ["tron:0XCD8690DC", TRON_NILE],
  ])("normalizes %s to %s", (legacy, canonical) => {
    expect(normalizeTronNetwork(legacy)).toBe(canonical);
    expect(tronNetworksEqual(legacy, canonical)).toBe(true);
  });

  it("leaves unknown non-hex identifiers unchanged", () => {
    expect(normalizeTronNetwork("tron:unknown")).toBe("tron:unknown");
  });

  it("resolves caller-owned records keyed by either representation", () => {
    expect(getTronNetworkValue({ [TRON_NILE]: "decimal" }, "tron:0xcd8690dc")).toBe("decimal");
    expect(getTronNetworkValue({ "tron:0xcd8690dc": "hex" }, TRON_NILE)).toBe("hex");
  });

  it("keeps direct lookup compatibility for exported network maps", () => {
    expect(TRON_CHAIN_IDS["tron:0xcd8690dc"]).toBe(TRON_CHAIN_IDS[TRON_NILE]);
    expect(PERMIT2_ADDRESSES["tron:0xcd8690dc"]).toBe(PERMIT2_ADDRESSES[TRON_NILE]);
  });
});
