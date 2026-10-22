import { describe, expect, it, vi } from "vitest";
import { x402Client } from "@x402/core/client";
import type { PaymentRequirements } from "@x402/core/types";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/client/scheme";
import { ExactGasFreeTronScheme } from "../../src/gasfree/client/scheme";
import type { ClientTronSigner } from "../../src/signer";
import { GasFreeAPIClient } from "../../src/shared/gasfree/api";

const network = "tron:3448148188";
const address = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const asset = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
function signer(): ClientTronSigner {
  return {
    address,
    signTypedData: vi.fn(async () => `0x${"11".repeat(65)}` as `0x${string}`),
    readContract: vi.fn(async args => (args.functionName === "channels" ? [0n, 0n] : 100_000_000n)),
    ensureAllowance: vi.fn(async () => true),
  };
}
function requirements(scheme: string, method = "permit2"): PaymentRequirements {
  return {
    scheme,
    network,
    asset,
    amount: "1000000",
    payTo: address,
    maxTimeoutSeconds: 600,
    extra: {
      assetTransferMethod: method,
      name: "Tether USD",
      version: "1",
      receiverAuthorizer: address,
    },
  };
}

describe("official Core atomic spend caps before TRON authorization", () => {
  it.each(["eip3009", "permit2"])(
    "rejects oversized default batch %s deposits before signing",
    async method => {
      const wallet = signer();
      const client = new x402Client()
        .setSpendControls({ maxAmountPerPayment: "1" })
        .register(network, new BatchSettlementTronScheme(wallet));
      await expect(
        client.createPaymentPayload({
          x402Version: 2,
          resource: { url: "https://test.invalid/paid" },
          accepts: [requirements("batch-settlement", method)],
        }),
      ).rejects.toThrow("payment_amount_exceeds_spend_cap");
      expect(wallet.signTypedData).not.toHaveBeenCalled();
      expect(wallet.ensureAllowance).not.toHaveBeenCalled();
    },
  );

  it("rejects a custom deposit above the cap and accepts the exact cap", async () => {
    const wallet = signer();
    const oversized = new BatchSettlementTronScheme(wallet, { depositStrategy: () => "2000000" });
    await expect(
      oversized.createPaymentPayload(2, requirements("batch-settlement"), {
        maxAmountPerPayment: "1000000",
      }),
    ).rejects.toThrow("payment_amount_exceeds_spend_cap");
    expect(wallet.signTypedData).not.toHaveBeenCalled();
    const allowed = new BatchSettlementTronScheme(wallet, { depositStrategy: () => "1000000" });
    await expect(
      allowed.createPaymentPayload(2, requirements("batch-settlement"), {
        maxAmountPerPayment: "1000000",
      }),
    ).resolves.toHaveProperty("payload.deposit.amount", "1000000");
  });

  it("retains uncapped default deposits and rejects an oversized direct request", async () => {
    const wallet = signer();
    const batch = new BatchSettlementTronScheme(wallet);
    await expect(
      batch.createPaymentPayload(2, requirements("batch-settlement")),
    ).resolves.toHaveProperty("payload.deposit.amount", "5000000");
    vi.mocked(wallet.signTypedData).mockClear();
    await expect(
      batch.createPaymentPayload(2, requirements("batch-settlement"), {
        maxAmountPerPayment: "999999",
      }),
    ).rejects.toThrow("payment_amount_exceeds_spend_cap");
    expect(wallet.signTypedData).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "counts GasFree transfer and activation fees (active=%s)",
    async active => {
      const wallet = signer();
      const api = new GasFreeAPIClient("http://127.0.0.1:1");
      vi.spyOn(api, "getAddressInfo").mockResolvedValue({
        accountAddress: address,
        gasFreeAddress: address,
        active,
        allowSubmit: true,
        nonce: 0,
        assets: [
          {
            tokenAddress: asset,
            tokenSymbol: "USDT",
            decimal: 6,
            frozen: 0,
            transferFee: "100000",
            activateFee: "200000",
          },
        ],
      });
      vi.spyOn(api, "getProviders").mockResolvedValue([
        {
          address,
          name: "test",
          icon: "",
          website: "",
          config: {
            maxPendingTransfer: 1,
            minDeadlineDuration: 60,
            maxDeadlineDuration: 600,
            defaultDeadlineDuration: 300,
          },
        },
      ]);
      const gasfree = new ExactGasFreeTronScheme(wallet, { apiClients: { [network]: api } });
      const req = { ...requirements("exact_gasfree"), extra: { serviceProvider: address } };
      await expect(
        gasfree.createPaymentPayload(2, req, { maxAmountPerPayment: "1000000" }),
      ).rejects.toThrow("payment_amount_exceeds_spend_cap");
      expect(wallet.signTypedData).not.toHaveBeenCalled();
      const total = active ? "1100000" : "1300000";
      await expect(
        gasfree.createPaymentPayload(2, req, { maxAmountPerPayment: total }),
      ).resolves.toHaveProperty("payload.gasfree.maxFee", active ? "100000" : "300000");
    },
  );
});
