import { tronAddressToEvm } from "@bankofai/x402-tron";
import { describe, expect, it } from "vitest";
import { x402Client } from "@x402/core/client";
import type { ClientTronSigner } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import { UptoTronScheme } from "@bankofai/x402-tron/upto/client";
import { BatchSettlementTronScheme } from "@bankofai/x402-tron/batch-settlement/client";
import * as ext from "../../src/trc20-approval-resource-sponsoring/index";

const network = "tron:3448148188";
const payer = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
function fixture(scheme: "exact" | "upto" | "batch-settlement", allowance: bigint) {
  const events: string[] = [];
  const signer: ClientTronSigner = {
    address: payer,
    network,
    readContract: async args => (args.functionName === "channels" ? [0n, 0n] : allowance),
    signTypedData: async () => {
      events.push("payment");
      return "0x1234";
    },
    ensureAllowance: async () => {
      events.push("self-funded");
      return true;
    },
    signPermit2Approval: async () => {
      events.push("approval");
      return "0a02abcd";
    },
  };
  const paymentRequired = {
    x402Version: 2,
    resource: { url: "https://example.test/paid" },
    accepts: [
      {
        scheme,
        network,
        asset: "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        amount: "1000",
        payTo: payer,
        maxTimeoutSeconds: 600,
        extra: {
          assetTransferMethod: "permit2",
          permit2FacilitatorAddress: payer,
          receiverAuthorizer: payer,
          withdrawDelay: 900,
        },
      },
    ],
    extensions: ext.declareTrc20ApprovalResourceSponsoringExtension(),
  };
  const client = new x402Client().register(
    network,
    scheme === "exact"
      ? new ExactTronScheme(signer)
      : scheme === "upto"
        ? new UptoTronScheme(signer)
        : new BatchSettlementTronScheme(signer),
  );
  return { client, signer, paymentRequired, events };
}
describe("official client extension composition", () => {
  it.each(["exact", "upto", "batch-settlement"] as const)(
    "pre-signs %s without self-funded approve",
    async scheme => {
      const f = fixture(scheme, 0n);
      f.client.registerExtension(
        ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer),
      );
      const snapshot = structuredClone(f.paymentRequired);
      const payload = await f.client.createPaymentPayload(f.paymentRequired);
      expect(payload.extensions?.trc20ApprovalResourceSponsoring).toMatchObject({
        info: { signedTransaction: "0a02abcd" },
      });
      expect(f.events).not.toContain("self-funded");
      expect(f.events.at(-1)).toBe("approval");
      expect(f.paymentRequired).toEqual(snapshot);
    },
  );
  it("removes unused declarations after official Core merges them", async () => {
    const f = fixture("exact", 1000000n);
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    const snapshot = structuredClone(f.paymentRequired);
    const payload = await f.client.createPaymentPayload(f.paymentRequired);
    expect(payload.extensions?.trc20ApprovalResourceSponsoring).toBeUndefined();
    expect(f.events).toEqual(["payment"]);
    expect(f.paymentRequired).toEqual(snapshot);
  });
  it("rejects advertised sponsoring when the client extension was not registered", async () => {
    const f = fixture("exact", 0n);
    await expect(f.client.createPaymentPayload(f.paymentRequired)).rejects.toThrow(
      /client_extension_not_registered/,
    );
    expect(f.events).not.toContain("self-funded");
  });
  it("checks batch allowance against the deposit rather than the route price", async () => {
    const f = fixture("batch-settlement", 2000n);
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    await expect(f.client.createPaymentPayload(f.paymentRequired)).rejects.toThrow(
      "approval_reset_required",
    );
    expect(f.events).not.toContain("approval");
    expect(f.events).not.toContain("self-funded");
  });
  it("isolates concurrent creations reusing one declaration object", async () => {
    const f = fixture("exact", 0n);
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    const snapshot = structuredClone(f.paymentRequired);
    const payloads = await Promise.all([
      f.client.createPaymentPayload(f.paymentRequired),
      f.client.createPaymentPayload(f.paymentRequired),
    ]);
    expect(payloads[0]).not.toBe(payloads[1]);
    for (const payload of payloads) {
      expect(payload.extensions?.trc20ApprovalResourceSponsoring).toMatchObject({
        info: { signedTransaction: "0a02abcd" },
      });
      expect(Object.getOwnPropertySymbols(payload)).toHaveLength(0);
    }
    expect(f.paymentRequired).toEqual(snapshot);
  });
  it("rejects missing RPC instead of signing or self-funding Approval", async () => {
    const f = fixture("exact", 0n);
    f.signer.readContract = undefined;
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    await expect(f.client.createPaymentPayload(f.paymentRequired)).rejects.toThrow(/readContract/);
    expect(f.events).not.toContain("approval");
    expect(f.events).not.toContain("self-funded");
  });
  it("rejects network mismatch before asking the wallet to sign", async () => {
    const f = fixture("exact", 0n);
    Object.defineProperty(f.signer, "network", { value: "tron:728126428" });
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    await expect(f.client.createPaymentPayload(f.paymentRequired)).rejects.toThrow(
      "approval_signer_network_mismatch",
    );
    expect(f.events).toEqual([]);
  });
  it("normalizes hex signer addresses to the canonical extension schema", async () => {
    const f = fixture("exact", 0n);
    f.signer.address = tronAddressToEvm(payer);
    f.client.registerExtension(ext.createTrc20ApprovalResourceSponsoringClientExtension(f.signer));
    const payment = await f.client.createPaymentPayload(f.paymentRequired);
    expect(payment.extensions?.trc20ApprovalResourceSponsoring).toMatchObject({
      info: { from: payer },
    });
  });
});
