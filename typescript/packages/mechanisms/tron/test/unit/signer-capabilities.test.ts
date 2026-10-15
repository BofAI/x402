import { describe, expect, it } from "vitest";
import { ExactTronScheme } from "../../src/exact/client";
import { toClientTronSigner } from "../../src/signer";
import { trySignTrc20ApprovalExtension } from "../../src/shared/extensions/resourceSponsoring";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "../../src/shared/extensions/trc20ApprovalContract";
import type { PaymentRequirements } from "@x402/core/types";

const requirements: PaymentRequirements = {
  scheme: "exact", network: "tron:3448148188", asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
  amount: "1000000", payTo: "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC", maxTimeoutSeconds: 600,
  extra: { name: "Tether USD", version: "1" },
};
const bare = {
  address: "0x1111111111111111111111111111111111111111",
  signTypedData: async () => "0x1234" as const,
};

describe("path-specific signer capabilities", () => {
  it("composes a typed-data-only signer for authorization without RPC", async () => {
    const client = new ExactTronScheme(toClientTronSigner(bare));
    expect(await client.createPaymentPayload(2, requirements)).toMatchObject({
      x402Version: 2, payload: { signature: "0x1234", authorization: { value: "1000000" } },
    });
    await expect(client.checkBalance(requirements.asset, requirements.network)).rejects.toThrow(/readContract/);
  });

  it("preserves the receiver of a contract-reader method", async () => {
    const original = { ...bare, balance: 42n, async readContract() { return this.balance; } };
    const client = new ExactTronScheme(toClientTronSigner(original));
    expect(await client.checkBalance(requirements.asset, requirements.network)).toBe(42n);
  });

  it("reports missing reads before attempting sponsored Approval", async () => {
    const signer = { ...bare, network: requirements.network };
    await expect(trySignTrc20ApprovalExtension(signer, requirements, {
      extensions: { [TRC20_APPROVAL_RESOURCE_SPONSORING_KEY]: { info: { version: "1" } } },
    })).rejects.toThrow(/readContract/);
  });
});
