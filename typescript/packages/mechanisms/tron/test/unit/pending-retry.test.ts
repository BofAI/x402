import { BatchSettlementTronScheme as BatchFacilitator } from "../../src/batch-settlement/facilitator";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import { InMemoryTronPendingSettlementStore } from "../../src/exact/facilitator";
import { describe, expect, it, vi } from "vitest";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { ExactTronScheme as ExactFacilitator } from "../../src/exact/facilitator";
import { ExactTronScheme as ExactServer } from "../../src/exact/server";
import { UptoTronScheme as UptoFacilitator } from "../../src/upto/facilitator";
import { UptoTronScheme as UptoServer } from "../../src/upto/server";
import {
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../../src/constants";
import { normalizeAddressForSigning } from "../../src/utils";
import type { FacilitatorTronSigner } from "../../src/signer";
import { TronSettlementTracker } from "../../src/shared/pendingSettlement";

const NETWORK = "tron:3448148188";
const TX = "11".repeat(32);
const PAYER = `0x${"11".repeat(20)}` as `0x${string}`;
const RECEIVER = `0x${"22".repeat(20)}` as `0x${string}`;
const TOKEN = `0x${"33".repeat(20)}` as `0x${string}`;

function fixture(kind: "exact-eip3009" | "exact-permit2" | "upto") {
  const scheme = kind === "upto" ? "upto" : "exact";
  const requirements: PaymentRequirements = {
    scheme,
    network: NETWORK,
    asset: TOKEN,
    amount: kind === "upto" ? "40" : "100",
    payTo: RECEIVER,
    maxTimeoutSeconds: 600,
    extra:
      kind === "exact-eip3009"
        ? { name: "Token", version: "1", assetTransferMethod: "eip3009" }
        : { assetTransferMethod: "permit2", permit2FacilitatorAddress: PAYER },
  };
  const signature = `0x${"44".repeat(65)}`;
  const payload =
    kind === "exact-eip3009"
      ? {
          signature,
          authorization: {
            from: PAYER,
            to: RECEIVER,
            value: "100",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 600),
            nonce: `0x${"55".repeat(32)}`,
          },
        }
      : {
          signature,
          permit2Authorization: {
            from: PAYER,
            permitted: { token: TOKEN, amount: "100" },
            spender: normalizeAddressForSigning(
              (kind === "upto" ? X402_UPTO_PERMIT2_PROXY_ADDRESSES : X402_PERMIT2_PROXY_ADDRESSES)[
                NETWORK
              ],
            ),
            nonce: "1",
            deadline: String(Math.floor(Date.now() / 1000) + 600),
            witness: {
              to: RECEIVER,
              validAfter: "0",
              ...(kind === "upto" ? { facilitator: PAYER } : {}),
            },
          },
        };
  const payment = {
    x402Version: 2,
    accepted: { ...requirements, amount: "100" },
    payload,
  } as PaymentPayload;
  return { requirements, payment };
}

for (const kind of ["exact-eip3009", "exact-permit2", "upto"] as const) {
  describe(`${kind} pending recovery through official Core`, () => {
    it.each(["pending", "success", "reverted"] as const)(
      "reconciles the original transaction when the next receipt is %s",
      async next => {
        const { payment, requirements } = fixture(kind);
        const writeContract = vi
          .fn()
          .mockResolvedValueOnce(TX)
          .mockRejectedValue(new Error("nonce already used"));
        const waitForTransactionReceipt = vi
          .fn()
          .mockResolvedValueOnce({ status: "pending" })
          .mockResolvedValue({ status: next });
        const signer: FacilitatorTronSigner = {
          getAddresses: () => [PAYER],
          readContract: async () => 1_000_000n,
          verifyTypedData: async () => true,
          writeContract,
          waitForTransactionReceipt,
        };
        const facilitator = new x402Facilitator().register(
          NETWORK,
          kind === "upto" ? new UptoFacilitator(signer) : new ExactFacilitator(signer),
        );
        const server = new x402ResourceServer({
          getSupported: async () => facilitator.getSupported(),
          verify: (p, r) => facilitator.verify(p, r),
          settle: (p, r) => facilitator.settle(p, r),
        }).register(NETWORK, kind === "upto" ? new UptoServer() : new ExactServer());
        await server.initialize();
        const result = await server.settlePayment(payment, requirements);
        expect(result.transaction).toBe(TX);
        expect(result.success).toBe(next === "success");
        if (next === "pending") expect(result.errorReason).toBe("settlement_pending");
        if (next === "success" && kind === "upto") expect(result.amount).toBe("40");
        expect(writeContract).toHaveBeenCalledTimes(1);
        expect(waitForTransactionReceipt).toHaveBeenCalledTimes(2);
        expect(waitForTransactionReceipt).toHaveBeenLastCalledWith({ hash: TX });
      },
    );
  });
}

function chain() {
  const writeContract = vi
    .fn()
    .mockResolvedValueOnce(TX)
    .mockRejectedValue(new Error("duplicate broadcast"));
  const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "pending" });
  const signer: FacilitatorTronSigner = {
    getAddresses: () => [PAYER],
    readContract: vi.fn(async () => 1_000_000n),
    verifyTypedData: vi.fn(async () => true),
    writeContract,
    waitForTransactionReceipt,
  };
  return { signer, writeContract, waitForTransactionReceipt };
}

describe("pending transaction storage boundaries", () => {
  it("does not classify invalid payment data as a storage outage", async () => {
    const { payment, requirements } = fixture("exact-eip3009");
    (payment.payload.authorization as { value: string }).value = "not-a-number";
    const f = chain();
    const result = await new ExactFacilitator(f.signer).settle(payment, requirements);
    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_execution_failed",
      transaction: "",
    });
    expect(result.errorMessage).not.toContain("reconcile");
    expect(f.signer.verifyTypedData).not.toHaveBeenCalled();
    expect(f.writeContract).not.toHaveBeenCalled();
  });

  it("recovers on another facilitator instance without re-verifying a consumed authorization", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    const first = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    expect(await first.settle(payment, requirements)).toMatchObject({
      errorReason: "settlement_pending",
      transaction: TX,
    });
    f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    vi.mocked(f.signer.readContract).mockRejectedValue(new Error("RPC unavailable"));
    vi.mocked(f.signer.verifyTypedData).mockRejectedValue(new Error("authorization expired"));
    const second = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    expect(
      await second.settle(structuredClone(payment), structuredClone(requirements)),
    ).toMatchObject({ success: true, transaction: TX });
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("serializes simultaneous attempts across instances sharing a store", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    const a = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    const b = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    const results = await Promise.all([
      a.settle(payment, requirements),
      b.settle(structuredClone(payment), requirements),
    ]);
    expect(results.map(r => r.transaction)).toEqual([TX, TX]);
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("uses a replacement shared record instead of its persisted local snapshot", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    const saved = vi.spyOn(store, "set");
    const scheme = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    await scheme.settle(payment, requirements);
    const replacement = "22".repeat(32);
    await store.set(saved.mock.calls[0][0], { transaction: replacement });
    f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    expect(await scheme.settle(payment, requirements)).toMatchObject({
      success: true,
      transaction: replacement,
    });
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not treat different settlement requirements as a cached success", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const scheme = new ExactFacilitator(f.signer);
    await scheme.settle(payment, requirements);
    f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const result = await scheme.settle(payment, { ...requirements, amount: "99" });
    expect(result.success).toBe(false);
    expect(result.transaction).toBe("");
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("rejects a store read failure before any broadcast", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    vi.spyOn(store, "get").mockRejectedValue(
      new Error("redis://sdk-release:secret@private-storage:6379"),
    );
    const result = await new ExactFacilitator(f.signer, { pendingSettlementStore: store }).settle(
      payment,
      requirements,
    );
    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_store_unavailable",
      transaction: "",
    });
    expect(result.errorMessage).not.toContain("sdk-release:secret");
    expect(f.writeContract).not.toHaveBeenCalled();
  });

  it("retains the original txID when a shared read fails on the original instance", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    const scheme = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    await scheme.settle(payment, requirements);
    vi.spyOn(store, "get").mockRejectedValue(new Error("private storage endpoint"));
    const result = await scheme.settle(payment, requirements);
    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_store_unavailable",
      transaction: TX,
    });
    expect(result.errorMessage).not.toContain("private storage endpoint");
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("classifies a failed save inside the callback as storage failure", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const store = new InMemoryTronPendingSettlementStore();
    vi.spyOn(store, "set").mockRejectedValue(new Error("private storage endpoint"));
    const result = await new TronSettlementTracker(store).run(
      payment,
      requirements,
      async pending => {
        await pending.save(TX);
        throw new Error("unreachable after failed save");
      },
    );
    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_store_unavailable",
      transaction: TX,
    });
    expect(result.errorMessage).not.toContain("private storage endpoint");
  });

  it("preserves the known transaction when a callback fails after saving it", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const tracker = new TronSettlementTracker();
    const failed = await tracker.run(payment, requirements, async pending => {
      await pending.save(TX);
      throw new Error("private business exception details");
    });
    expect(failed).toMatchObject({
      success: false,
      errorReason: "settlement_execution_failed",
      transaction: TX,
    });
    expect(failed.errorMessage).not.toContain("private business exception details");
    const recovered = await tracker.run(payment, requirements, async pending => ({
      success: true,
      transaction: pending.record!.transaction,
      network: NETWORK,
    }));
    expect(recovered).toMatchObject({ success: true, transaction: TX });
  });

  it("keeps the original transaction locally if persistence fails after broadcast", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    vi.spyOn(store, "set").mockRejectedValueOnce(
      new Error("redis://sdk-release:secret@private-storage:6379"),
    );
    const scheme = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    const failed = await scheme.settle(payment, requirements);
    expect(failed).toMatchObject({ errorReason: "settlement_store_unavailable", transaction: TX });
    expect(failed.errorMessage).not.toContain("sdk-release:secret");
    f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    expect(await scheme.settle(payment, requirements)).toMatchObject({
      success: true,
      transaction: TX,
    });
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });

  it("does not turn confirmed payment into failure when store cleanup fails", async () => {
    const { payment, requirements } = fixture("exact-permit2");
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    vi.spyOn(store, "delete").mockRejectedValue(
      new Error("redis://sdk-release:secret@private-storage:6379"),
    );
    f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
    const scheme = new ExactFacilitator(f.signer, { pendingSettlementStore: store });
    expect(await scheme.settle(payment, requirements)).toMatchObject({
      success: true,
      transaction: TX,
    });
    expect(await scheme.settle(payment, requirements)).toMatchObject({
      success: true,
      transaction: TX,
    });
    expect(f.writeContract).toHaveBeenCalledTimes(1);
  });
});

describe("batch action pending snapshots", () => {
  it("preserves the txID if a persisted snapshot cannot be recovered", async () => {
    const f = chain();
    const store = new InMemoryTronPendingSettlementStore();
    vi.spyOn(store, "get").mockResolvedValue({ transaction: TX });
    const { requirements: exact } = fixture("exact-permit2");
    const requirements = { ...exact, scheme: "batch-settlement" };
    const config = {
      payer: PAYER,
      payerAuthorizer: PAYER,
      receiver: RECEIVER,
      receiverAuthorizer: RECEIVER,
      token: TOKEN,
      withdrawDelay: 900,
      salt: `0x${"77".repeat(32)}` as `0x${string}`,
    };
    const payment = {
      x402Version: 2,
      accepted: requirements,
      payload: {
        type: "refund",
        channelConfig: config,
        voucher: {
          channelId: computeChannelId(config, NETWORK),
          maxClaimableAmount: "0",
          signature: "0x11",
        },
        amount: "10",
        refundNonce: "0",
        claims: [],
        refundAuthorizerSignature: "0x22",
      },
    } as PaymentPayload;
    const result = await new BatchFacilitator(f.signer, undefined, {
      pendingSettlementStore: store,
    }).settle(payment, requirements);
    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_store_unavailable",
      transaction: TX,
    });
    expect(f.writeContract).not.toHaveBeenCalled();
  });

  it.each(["claim", "settle", "refund"] as const)(
    "recovers %s on a fresh instance with the original amount and snapshot",
    async type => {
      const f = chain();
      const store = new InMemoryTronPendingSettlementStore();
      const config = {
        payer: PAYER,
        payerAuthorizer: PAYER,
        receiver: RECEIVER,
        receiverAuthorizer: RECEIVER,
        token: TOKEN,
        withdrawDelay: 900,
        salt: `0x${"77".repeat(32)}` as `0x${string}`,
      };
      let confirmed = false;
      vi.mocked(f.signer.readContract).mockImplementation(async ({ functionName }) => {
        if (type === "refund" && confirmed) throw new Error("live nonce/state changed");
        if (functionName === "receivers") return [100n, confirmed ? 100n : 0n];
        if (functionName === "channels") return [100n, 0n];
        if (functionName === "pendingWithdrawals") return [0n, 0n];
        if (functionName === "refundNonce") return 0n;
        throw new Error(`unexpected read ${functionName}`);
      });
      const raw =
        type === "claim"
          ? { type, claims: [], claimAuthorizerSignature: `0x${"66".repeat(65)}` }
          : type === "settle"
            ? { type, receiver: RECEIVER, token: TOKEN }
            : {
                type,
                channelConfig: config,
                voucher: {
                  channelId: computeChannelId(config, NETWORK),
                  maxClaimableAmount: "0",
                  signature: `0x${"88".repeat(65)}`,
                },
                amount: "10",
                refundNonce: "0",
                claims: [],
                refundAuthorizerSignature: `0x${"99".repeat(65)}`,
              };
      const { requirements: exact } = fixture("exact-permit2");
      const requirements = { ...exact, scheme: "batch-settlement" };
      const payment = { x402Version: 2, accepted: requirements, payload: raw } as PaymentPayload;
      const first = new BatchFacilitator(f.signer, undefined, { pendingSettlementStore: store });
      expect(await first.settle(payment, requirements)).toMatchObject({
        errorReason: "settlement_pending",
        transaction: TX,
      });
      confirmed = true;
      f.waitForTransactionReceipt.mockResolvedValue({ status: "success" });
      const second = new BatchFacilitator(f.signer, undefined, { pendingSettlementStore: store });
      const result = await second.settle(structuredClone(payment), requirements);
      expect(result).toMatchObject({
        success: true,
        transaction: TX,
        amount: type === "claim" ? "" : type === "settle" ? "100" : "10",
      });
      if (type === "refund")
        expect(result.extra).toMatchObject({ channelState: { balance: "90", refundNonce: "1" } });
      expect(f.writeContract).toHaveBeenCalledTimes(1);
    },
  );
});
