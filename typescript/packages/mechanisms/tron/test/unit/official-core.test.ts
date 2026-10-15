import { describe, expect, it } from "vitest";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { TronWeb } from "tronweb";
import { ExactTronScheme as ExactClient } from "../../src/exact/client";
import { ExactTronScheme as ExactServer } from "../../src/exact/server";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator";
import { UptoTronScheme as UptoClient } from "../../src/upto/client";
import { UptoTronScheme as UptoServer } from "../../src/upto/server";
import { UptoTronScheme as UptoFacilitator } from "../../src/upto/facilitator";
import { BatchSettlementTronScheme as BatchClient } from "../../src/batch-settlement/client";
import { BatchSettlementTronScheme as BatchServer } from "../../src/batch-settlement/server";
import { BatchSettlementTronScheme as BatchFacilitator } from "../../src/batch-settlement/facilitator";
import { createFacilitatorTronSigner, type ClientTronSigner } from "../../src/signer";
import { privateKeyTronWallet } from "./helpers";

const NETWORK = "tron:3448148188";
const KEY = "0000000000000000000000000000000000000000000000000000000000000001";
const RECEIVER = "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC";
const TX = "11".repeat(32);
const wallet = privateKeyTronWallet(new TronWeb({ fullHost: "http://127.0.0.1:1" }), KEY);
const signer: ClientTronSigner = {
  address: wallet.getAddress() as string,
  signTypedData: async args => `0x${(await wallet.signTypedData(args)).replace(/^0x/, "")}`,
  readContract: async () => [0n, 0n],
};

async function settlementSigner() {
  const base = await createFacilitatorTronSigner({
    getAddress: () => RECEIVER,
    signTransaction: async () => { throw new Error("unexpected wallet signing"); },
  }, { network: NETWORK });
  return {
    ...base,
    readContract: async () => 100_000_000n,
    writeContract: async () => TX,
    waitForTransactionReceipt: async () => ({ status: "success" as const }),
  };
}

describe("TRON composed with published official Core", () => {
  it.each(["exact", "upto"] as const)("creates, verifies and settles %s through Core", async scheme => {
    const chain = await settlementSigner();
    const facilitator = new x402Facilitator().register(NETWORK,
      scheme === "exact" ? new ExactFacilitator(chain) : new UptoFacilitator(chain));
    const server = new x402ResourceServer({
      getSupported: async () => facilitator.getSupported(),
      verify: (payload, requirements) => facilitator.verify(payload, requirements),
      settle: (payload, requirements) => facilitator.settle(payload, requirements),
    }).register(NETWORK, scheme === "exact" ? new ExactServer() : new UptoServer());
    await server.initialize();
    const accepts = await server.buildPaymentRequirements({ scheme, network: NETWORK,
      price: "1 USDT", payTo: RECEIVER, maxTimeoutSeconds: 600 });
    const client = new x402Client().register(NETWORK,
      scheme === "exact" ? new ExactClient(signer) : new UptoClient(signer));
    const payload = await client.createPaymentPayload({ x402Version: 2, accepts,
      resource: { url: "https://example.test/paid", description: "test", mimeType: "text/plain" } });
    expect(payload.accepted.scheme).toBe(scheme);
    expect(payload.accepted.amount).toBe("1000000");
    expect(await server.verifyPayment(payload, accepts[0])).toMatchObject({ isValid: true });
    expect(await server.settlePayment(payload, accepts[0])).toMatchObject({ success: true, transaction: TX, network: NETWORK });
  });

  it("dispatches batch deposit creation through Core with an advertised authorizer", async () => {
    const chain = await settlementSigner();
    const authorizer = { ...signer, address: RECEIVER };
    const facilitator = new x402Facilitator().register(NETWORK, new BatchFacilitator(chain, authorizer));
    const server = new x402ResourceServer({
      getSupported: async () => facilitator.getSupported(),
      verify: (payload, requirements) => facilitator.verify(payload, requirements),
      settle: (payload, requirements) => facilitator.settle(payload, requirements),
    }).register(NETWORK, new BatchServer(RECEIVER));
    await server.initialize();
    const accepts = await server.buildPaymentRequirements({ scheme: "batch-settlement", network: NETWORK,
      price: "0.1 USDT", payTo: RECEIVER, maxTimeoutSeconds: 600 });
    const client = new x402Client().register(NETWORK, new BatchClient(signer));
    const payload = await client.createPaymentPayload({ x402Version: 2, accepts,
      resource: { url: "https://example.test/paid", description: "test", mimeType: "text/plain" } });
    expect(payload.payload).toMatchObject({ type: "deposit", deposit: { amount: "500000" },
      voucher: { maxClaimableAmount: "100000" } });
    expect(accepts[0].extra.receiverAuthorizer).toBe(RECEIVER);
  });
});
