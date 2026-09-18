import { describe, expect, it } from "vitest";
import type { PaymentRequirements } from "@bankofai/x402-core/types";
import { ExactTronScheme } from "../../src/exact/server/scheme";
import { UptoTronScheme } from "../../src/upto/server/scheme";
import { ExactGasFreeTronScheme } from "../../src/gasfree/server/scheme";

const NETWORK = "tron:3448148188";

function requirements(scheme: "exact" | "upto"): PaymentRequirements {
  return {
    scheme,
    network: NETWORK,
    asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
    amount: "1000000",
    payTo: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
    maxTimeoutSeconds: 60,
    extra: {
      fee: { feeTo: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC", feeAmount: "5000" },
    },
  } as unknown as PaymentRequirements;
}

describe("advisory fee removal", () => {
  it("strips upstream fee metadata from exact requirements", async () => {
    const result = await new ExactTronScheme().enhancePaymentRequirements(
      requirements("exact"),
      {
        x402Version: 2,
        scheme: "exact",
        network: NETWORK,
        extra: { supportedAssetTransferMethods: ["permit2"] },
      },
      [],
    );

    expect(result.extra?.fee).toBeUndefined();
  });

  it("strips upstream fee metadata from exact requirements without a transfer method", async () => {
    const result = await new ExactTronScheme().enhancePaymentRequirements(
      requirements("exact"),
      { x402Version: 2, scheme: "exact", network: NETWORK },
      [],
    );

    expect(result.extra?.fee).toBeUndefined();
  });

  it("strips upstream fee metadata from upto requirements", async () => {
    const result = await new UptoTronScheme().enhancePaymentRequirements(
      requirements("upto"),
      { x402Version: 2, scheme: "upto", network: NETWORK },
      [],
    );

    expect(result.extra?.fee).toBeUndefined();
  });
});

describe("advisory fee removal — gasfree", () => {
  it("strips upstream fee and direct-transfer metadata from gasfree requirements", async () => {
    const input = requirements("exact" as "exact_gasfree");
    input.extra = { ...input.extra, assetTransferMethod: "permit2" };
    const result = await new ExactGasFreeTronScheme().enhancePaymentRequirements(
      input,
      {
        x402Version: 2,
        scheme: "exact_gasfree",
        network: NETWORK,
      },
      [],
    );

    expect(result.extra?.fee).toBeUndefined();
    expect(result.extra?.assetTransferMethod).toBeUndefined();
  });
});
