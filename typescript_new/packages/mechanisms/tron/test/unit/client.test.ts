import { describe, expect, it, vi } from "vitest";
import { ExactTronScheme } from "../../src/exact/client/scheme";
import { createSignedTransfer, REQUIREMENTS } from "./helpers";

describe("Exact TRON client scheme", () => {
  it("builds and signs a TRC-20 transfer", async () => {
    const transaction = createSignedTransfer();
    const signer = {
      address: "payer",
      buildTransferTransaction: vi.fn(async () => transaction),
      signTransaction: vi.fn(async () => transaction),
    };
    const scheme = new ExactTronScheme(signer, { feeLimit: 50_000_000 });

    const result = await scheme.createPaymentPayload(2, REQUIREMENTS);

    expect(signer.buildTransferTransaction).toHaveBeenCalledWith(REQUIREMENTS, 50_000_000);
    expect((result.payload as { transaction: unknown }).transaction).toBe(transaction);
  });

  it("rejects unsupported protocol versions", async () => {
    const transaction = createSignedTransfer();
    const signer = {
      address: "payer",
      buildTransferTransaction: vi.fn(async () => transaction),
      signTransaction: vi.fn(async () => transaction),
    };
    await expect(new ExactTronScheme(signer).createPaymentPayload(1, REQUIREMENTS)).rejects.toThrow(
      "version 2 only",
    );
  });

  it("rejects invalid atomic amounts", async () => {
    const transaction = createSignedTransfer();
    const signer = {
      address: "payer",
      buildTransferTransaction: vi.fn(async () => transaction),
      signTransaction: vi.fn(async () => transaction),
    };
    await expect(
      new ExactTronScheme(signer).createPaymentPayload(2, { ...REQUIREMENTS, amount: "1.5" }),
    ).rejects.toThrow("positive integer");
  });
});
