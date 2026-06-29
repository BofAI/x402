import { describe, expect, it } from "vitest";
import { ExactGasFreeTronScheme as GasFreeFacilitator } from "../../src/gasfree/facilitator/scheme";
import type { FacilitatorTronSigner } from "../../src/signer";

/**
 * Regression: the GasFree facilitator must NOT advertise its own address as
 * `feeTo`.
 *
 * GasFree's `feeTo` is the relayer's service provider — `verify` rejects any
 * other address with `gasfree_fee_to_mismatch`. The facilitator's own wallet is
 * not a registered provider, so defaulting to it (the prior behavior) made every
 * gasfree payment fail. getExtra now omits `feeTo` unless it is explicitly
 * configured to a real provider, letting the client pick one from the relayer's
 * provider list (mirroring the Python facilitator's `fee_quote`).
 */

const NETWORK = "tron:nile";
const SIGNER_ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC"; // facilitator wallet (NOT a provider)
const PROVIDER = "TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E"; // a registered relayer provider

function mockSigner(): FacilitatorTronSigner {
  return {
    getAddresses: () => [SIGNER_ADDR],
    readContract: async () => 0n,
    verifyTypedData: async () => true,
    writeContract: async () => "0x",
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as FacilitatorTronSigner;
}

describe("GasFree facilitator getExtra feeTo advertisement", () => {
  it("omits feeConfig entirely when no baseFee is configured", () => {
    const extra = new GasFreeFacilitator(mockSigner(), {}).getExtra(NETWORK);
    expect(extra?.feeConfig).toBeUndefined();
  });

  it("advertises baseFee WITHOUT feeTo when feeTo is not configured", () => {
    const f = new GasFreeFacilitator(mockSigner(), {}, { baseFee: { USDT: "10000" } });
    const feeConfig = f.getExtra(NETWORK)?.feeConfig as Record<string, unknown>;

    expect(feeConfig).toEqual({ baseFee: { USDT: "10000" } });
    // The fix: never fall back to the facilitator's own address.
    expect(feeConfig).not.toHaveProperty("feeTo");
    expect(feeConfig.feeTo).not.toBe(SIGNER_ADDR);
  });

  it("advertises feeTo only when explicitly configured to a provider", () => {
    const f = new GasFreeFacilitator(
      mockSigner(),
      {},
      { feeTo: PROVIDER, baseFee: { USDT: "10000" } },
    );
    const feeConfig = f.getExtra(NETWORK)?.feeConfig as Record<string, unknown>;

    expect(feeConfig.feeTo).toBe(PROVIDER);
    expect(feeConfig.baseFee).toEqual({ USDT: "10000" });
  });

  it("passes through caller and allowedTokens when configured", () => {
    const f = new GasFreeFacilitator(
      mockSigner(),
      {},
      { feeTo: PROVIDER, caller: PROVIDER, baseFee: { USDT: "10000" }, allowedTokens: ["USDT"] },
    );
    const feeConfig = f.getExtra(NETWORK)?.feeConfig as Record<string, unknown>;

    expect(feeConfig).toEqual({
      feeTo: PROVIDER,
      caller: PROVIDER,
      baseFee: { USDT: "10000" },
      allowedTokens: ["USDT"],
    });
  });
});
