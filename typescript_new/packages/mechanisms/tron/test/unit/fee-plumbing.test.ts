import { describe, expect, it } from "vitest";
import { ExactTronScheme as FacilitatorScheme } from "../../src/exact/facilitator/scheme";
import { ExactTronScheme as ServerScheme } from "../../src/exact/server/scheme";
import type { FacilitatorTronSigner } from "../../src/signer";
import type { PaymentRequirements } from "@x402/core/types";

/**
 * Proves the fee plumbing: facilitator getExtra advertises feeConfig, and the
 * server's enhancePaymentRequirements turns it into per-asset extra.fee (F3).
 */

const NETWORK = "tron:nile";
const USDT = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const USDD = "TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK";
const SIGNER_ADDR = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";

function mockSigner(): FacilitatorTronSigner {
  return {
    getAddresses: () => [SIGNER_ADDR],
    readContract: async () => 0n,
    verifyTypedData: async () => true,
    writeContract: async () => "0x",
    waitForTransactionReceipt: async () => ({ status: "success" }),
  };
}

function baseRequirements(asset: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset,
    amount: "1000000",
    payTo: "TPayToAddress00000000000000000000000",
    resource: "https://example.com/resource",
    description: "",
    mimeType: "",
    maxTimeoutSeconds: 60,
    extra: {},
  } as unknown as PaymentRequirements;
}

describe("facilitator getExtra fee advertisement", () => {
  it("omits feeConfig when no baseFee is configured", () => {
    const extra = new FacilitatorScheme(mockSigner()).getExtra(NETWORK);
    expect(extra?.feeConfig).toBeUndefined();
  });

  it("advertises feeConfig with signer as default feeTo", () => {
    const f = new FacilitatorScheme(mockSigner(), { baseFee: { USDT: "10000" } });
    const extra = f.getExtra(NETWORK);
    expect(extra?.feeConfig).toEqual({
      feeTo: SIGNER_ADDR,
      baseFee: { USDT: "10000" },
    });
  });
});

describe("server enhancePaymentRequirements fee injection", () => {
  const server = new ServerScheme();

  function supportedKind(feeConfig?: Record<string, unknown>) {
    return {
      x402Version: 2,
      scheme: "exact",
      network: NETWORK,
      extra: {
        supportedAssetTransferMethods: ["permit2"],
        ...(feeConfig ? { feeConfig } : {}),
      },
    };
  }

  it("injects extra.fee for a configured token", async () => {
    const out = await server.enhancePaymentRequirements(
      baseRequirements(USDT),
      supportedKind({ feeTo: SIGNER_ADDR, baseFee: { USDT: "10000" } }),
      [],
    );
    expect(out.extra?.fee).toEqual({ feeTo: SIGNER_ADDR, feeAmount: "10000" });
  });

  it("does not inject fee for a token absent from baseFee", async () => {
    const out = await server.enhancePaymentRequirements(
      baseRequirements(USDD),
      supportedKind({ feeTo: SIGNER_ADDR, baseFee: { USDT: "10000" } }),
      [],
    );
    expect(out.extra?.fee).toBeUndefined();
  });

  it("preserves a fee already present upstream", async () => {
    const req = baseRequirements(USDT);
    req.extra = { fee: { feeTo: "TPreset", feeAmount: "1" } };
    const out = await server.enhancePaymentRequirements(
      req,
      supportedKind({ feeTo: SIGNER_ADDR, baseFee: { USDT: "10000" } }),
      [],
    );
    expect(out.extra?.fee).toEqual({ feeTo: "TPreset", feeAmount: "1" });
  });

  it("omits fee when facilitator advertises none", async () => {
    const out = await server.enhancePaymentRequirements(
      baseRequirements(USDT),
      supportedKind(),
      [],
    );
    expect(out.extra?.fee).toBeUndefined();
  });
});
