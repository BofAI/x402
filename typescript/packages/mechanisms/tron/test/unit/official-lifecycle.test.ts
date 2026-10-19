import { InMemoryTronPendingSettlementStore } from "../../src/gasfree/facilitator";
import { InMemoryClientChannelStorage } from "../../src/batch-settlement/client";
import { InMemoryChannelStorage } from "../../src/batch-settlement/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { x402Client } from "@x402/core/client";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402ResourceServer } from "@x402/core/server";
import { TronWeb } from "tronweb";
import { BatchSettlementTronScheme as BatchClient } from "../../src/batch-settlement/client";
import { BatchSettlementTronScheme as BatchServer } from "../../src/batch-settlement/server";
import { BatchSettlementTronScheme as BatchFacilitator } from "../../src/batch-settlement/facilitator";
import { ExactGasFreeTronScheme as GasClient } from "../../src/gasfree/client";
import { ExactGasFreeTronScheme as GasServer } from "../../src/gasfree/server";
import { ExactGasFreeTronScheme as GasFacilitator } from "../../src/gasfree/facilitator";
import { GasFreeTransactionStatusError, GasFreeAPIClient } from "../../src/shared/gasfree/api";
import { createFacilitatorTronSigner } from "../../src/signer";
import type { ClientTronSigner } from "../../src/signer";
import type {
  BatchSettlementDepositPayload,
  BatchSettlementVoucherPayload,
} from "../../src/batch-settlement/types";
import { privateKeyTronWallet } from "./helpers";
import { ErrChannelBusy, ErrCumulativeAmountMismatch } from "../../src/batch-settlement/errors";

const NETWORK = "tron:3448148188";
const KEY = "0000000000000000000000000000000000000000000000000000000000000001";
const ADDRESS = TronWeb.address.fromPrivateKey(KEY) as string;
const TOKEN = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const TX = "11".repeat(32);
const resource = { url: "https://example.test/paid", description: "test", mimeType: "text/plain" };
const wallet = privateKeyTronWallet(new TronWeb({ fullHost: "http://127.0.0.1:1" }), KEY);
const signer: ClientTronSigner = {
  address: ADDRESS,
  signTypedData: async args => `0x${(await wallet.signTypedData(args)).replace(/^0x/, "")}`,
  readContract: async () => [0n, 0n],
};

afterEach(() => vi.restoreAllMocks());

async function batch(status: "success" | "pending" = "success") {
  let balance = 0n;
  const base = await createFacilitatorTronSigner(
    {
      getAddress: () => ADDRESS,
      signTransaction: async () => {
        throw new Error("unexpected signing");
      },
    },
    { network: NETWORK },
  );
  const chain = {
    ...base,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "channels") return [balance, 0n];
      if (functionName === "pendingWithdrawals") return [0n, 0n];
      if (functionName === "refundNonce") return 0n;
      return 100000000n;
    },
    writeContract: vi.fn(async () => {
      if (status === "success") balance = 500000n;
      return TX;
    }),
    waitForTransactionReceipt: vi.fn(async () => ({ status })),
  };
  const facilitator = new x402Facilitator().register(NETWORK, new BatchFacilitator(chain, signer));
  const serverScheme = new BatchServer(ADDRESS);
  const server = new x402ResourceServer({
    getSupported: async () => ({
      ...facilitator.getSupported(),
      kinds: facilitator.getSupported().kinds.map(kind => ({ ...kind, network: NETWORK })),
    }),
    verify: (p, r) => facilitator.verify(p, r),
    settle: (p, r) => facilitator.settle(p, r),
  }).register(NETWORK, serverScheme);
  await server.initialize();
  const accepts = await server.buildPaymentRequirements({
    scheme: "batch-settlement",
    network: NETWORK,
    price: "0.1 USDT",
    payTo: ADDRESS,
    maxTimeoutSeconds: 600,
  });
  const clientStorage = new InMemoryClientChannelStorage();
  const clientScheme = new BatchClient(signer, { storage: clientStorage });
  const client = new x402Client().register(NETWORK, clientScheme);
  const payment = await client.createPaymentPayload({ x402Version: 2, accepts, resource });
  const channelId = (payment.payload as BatchSettlementDepositPayload).voucher.channelId;
  return {
    chain,
    server,
    facilitator,
    clientStorage,
    serverScheme,
    client,
    clientScheme,
    payment,
    channelId,
    requirements: accepts[0],
    accepts,
  };
}

describe("batch lifecycle dispatched by official Core", () => {
  it("restores saved client and server storage into fresh official Core instances", async () => {
    const f = await batch();
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    const settled = await f.server.settlePayment(f.payment, f.requirements);
    expect(settled.success).toBe(true);
    await f.client.handlePaymentResponse({
      paymentPayload: f.payment,
      requirements: f.requirements,
      settleResponse: settled,
    });
    const serverStorage = new InMemoryChannelStorage();
    for (const saved of await f.serverScheme.getStorage().list()) {
      await serverStorage.updateChannel(saved.channelId, () => structuredClone(saved));
    }
    const savedClient = await f.clientStorage.get(f.channelId);
    expect(savedClient).toBeDefined();
    const clientStorage = new InMemoryClientChannelStorage();
    await clientStorage.set(f.channelId, structuredClone(savedClient!));
    const server = new x402ResourceServer({
      getSupported: async () => ({
        ...f.facilitator.getSupported(),
        kinds: f.facilitator.getSupported().kinds.map(kind => ({ ...kind, network: NETWORK })),
      }),
      verify: (p, r) => f.facilitator.verify(p, r),
      settle: (p, r) => f.facilitator.settle(p, r),
    }).register(NETWORK, new BatchServer(ADDRESS, { storage: serverStorage }));
    await server.initialize();
    const client = new x402Client().register(
      NETWORK,
      new BatchClient(signer, { storage: clientStorage }),
    );
    const payment = await client.createPaymentPayload({
      x402Version: 2,
      accepts: f.accepts,
      resource,
    });
    expect(payment.payload).toMatchObject({
      type: "voucher",
      voucher: { maxClaimableAmount: "200000" },
    });
    expect(await server.verifyPayment(payment, f.requirements)).toMatchObject({ isValid: true });
    expect(await server.settlePayment(payment, f.requirements)).toMatchObject({
      success: true,
      transaction: "",
    });
    expect(await serverStorage.get(f.channelId)).toMatchObject({
      chargedCumulativeAmount: "200000",
      pendingRequest: undefined,
    });
  });

  it("credits a deposit, reconciles the client and charges the next voucher without a transaction", async () => {
    const f = await batch();
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    expect((await f.serverScheme.getStorage().get(f.channelId))?.pendingRequest).toBeDefined();
    const settled = await f.server.settlePayment(f.payment, f.requirements);
    expect(settled).toMatchObject({
      success: true,
      transaction: TX,
      extra: {
        chargedAmount: "100000",
        channelState: { balance: "500000", chargedCumulativeAmount: "100000" },
      },
    });
    await f.client.handlePaymentResponse({
      paymentPayload: f.payment,
      requirements: f.requirements,
      settleResponse: settled,
    });
    const next = await f.client.createPaymentPayload({
      x402Version: 2,
      accepts: f.accepts,
      resource,
    });
    expect(next.payload).toMatchObject({
      type: "voucher",
      voucher: { maxClaimableAmount: "200000" },
    });
    expect(await f.server.verifyPayment(next, f.requirements)).toMatchObject({ isValid: true });
    expect(await f.server.settlePayment(next, f.requirements)).toMatchObject({
      success: true,
      transaction: "",
    });
    expect(await f.serverScheme.getStorage().get(f.channelId)).toMatchObject({
      chargedCumulativeAmount: "200000",
      pendingRequest: undefined,
    });
  });

  it("cancellation releases a verified reservation without charging the channel", async () => {
    const f = await batch();
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    await f.server
      .createPaymentCancellationDispatcher(f.payment, f.requirements)
      .cancel({ reason: "handler_failed", responseStatus: 500 });
    expect(await f.serverScheme.getStorage().get(f.channelId)).toMatchObject({
      chargedCumulativeAmount: "0",
      pendingRequest: undefined,
    });
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
  });

  it("enriches and settles a cooperative refund without charging for the refund request", async () => {
    const f = await batch();
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    expect(await f.server.settlePayment(f.payment, f.requirements)).toMatchObject({
      success: true,
    });
    const deposit = f.payment.payload as BatchSettlementDepositPayload;
    const refund = {
      ...f.payment,
      payload: { type: "refund", channelConfig: deposit.channelConfig, voucher: deposit.voucher },
    };
    expect(await f.server.verifyPayment(refund, f.requirements)).toMatchObject({
      isValid: true,
      skipHandler: { contentType: "application/json" },
    });
    const result = await f.server.settlePayment(refund, f.requirements);
    expect(result).toMatchObject({
      success: true,
      amount: "400000",
      extra: {
        channelState: {
          chargedCumulativeAmount: "100000",
          totalClaimed: "100000",
          balance: "100000",
          refundNonce: "1",
        },
      },
    });
    expect(await f.serverScheme.getStorage().get(f.channelId)).toBeUndefined();
  });

  it("pending deposit retains its txID and does not book a successful charge", async () => {
    const f = await batch("pending");
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    expect(await f.server.settlePayment(f.payment, f.requirements)).toMatchObject({
      success: false,
      transaction: TX,
      errorReason: "settlement_pending",
    });
    const stored = await f.serverScheme.getStorage().get(f.channelId);
    expect(stored?.chargedCumulativeAmount ?? "0").toBe("0");
    expect(f.chain.writeContract).toHaveBeenCalledTimes(1);
  });

  it("recovers a pending deposit with its original tx and confirmed channel snapshot", async () => {
    const f = await batch();
    f.chain.waitForTransactionReceipt.mockResolvedValueOnce({ status: "pending" });
    await f.server.verifyPayment(f.payment, f.requirements);
    expect(await f.server.settlePayment(f.payment, f.requirements)).toMatchObject({
      success: true,
      transaction: TX,
      amount: "500000",
      extra: { channelState: { balance: "500000" } },
    });
    expect(f.chain.writeContract).toHaveBeenCalledTimes(1);
    expect((await f.serverScheme.getStorage().get(f.channelId))?.chargedCumulativeAmount).toBe(
      "100000",
    );
  });

  it("rejects concurrent reservations and returns corrective channel state for stale vouchers", async () => {
    const f = await batch();
    expect(await f.server.verifyPayment(f.payment, f.requirements)).toMatchObject({
      isValid: true,
    });
    const concurrent = structuredClone(f.payment);
    expect(await f.server.verifyPayment(concurrent, f.requirements)).toMatchObject({
      isValid: false,
      invalidReason: ErrChannelBusy,
    });
    const settled = await f.server.settlePayment(f.payment, f.requirements);
    await f.client.handlePaymentResponse({
      paymentPayload: f.payment,
      requirements: f.requirements,
      settleResponse: settled,
    });
    const next = await f.client.createPaymentPayload({
      x402Version: 2,
      accepts: f.accepts,
      resource,
    });
    const stale = structuredClone(next);
    (stale.payload as BatchSettlementVoucherPayload).voucher.maxClaimableAmount = "100000";
    expect(await f.server.verifyPayment(stale, f.requirements)).toMatchObject({
      isValid: false,
      invalidReason: ErrCumulativeAmountMismatch,
    });
    const corrective = await f.server.createPaymentRequiredResponse(
      f.accepts,
      resource,
      ErrCumulativeAmountMismatch,
      undefined,
      undefined,
      stale,
    );
    expect(corrective.accepts[0].extra).toMatchObject({
      channelState: { chargedCumulativeAmount: "100000" },
    });
  });
});

describe("GasFree composed with official Core", () => {
  it.each(["direct", "pending", "success", "reverted", "trace", "failed-trace"] as const)(
    "signs and settles without resubmission when relayer recovery is %s",
    async recovery => {
      const api = new GasFreeAPIClient("http://127.0.0.1:1");
      const gasFreeAddress = TronWeb.address.fromPrivateKey("02".padStart(64, "0")) as string;
      const provider = TronWeb.address.fromPrivateKey("03".padStart(64, "0")) as string;
      vi.spyOn(api, "getAddressInfo").mockResolvedValue({
        accountAddress: ADDRESS,
        gasFreeAddress,
        active: true,
        allowSubmit: true,
        nonce: 4,
        assets: [
          {
            tokenAddress: TOKEN,
            tokenSymbol: "USDT",
            transferFee: "10000",
            activateFee: "0",
            decimal: 6,
            frozen: 0,
          },
        ],
      });
      vi.spyOn(api, "getProviders").mockResolvedValue([
        {
          address: provider,
          name: "test",
          icon: "",
          website: "",
          config: {
            maxPendingTransfer: 10,
            minDeadlineDuration: 60,
            maxDeadlineDuration: 3600,
            defaultDeadlineDuration: 600,
          },
        },
      ]);
      vi.spyOn(api, "submit").mockResolvedValue("trace-1");
      vi.spyOn(api, "waitForSuccess").mockResolvedValue({
        id: "trace-1",
        state: "SUCCEED",
        createdAt: "",
        accountAddress: ADDRESS,
        gasFreeAddress,
        providerAddress: provider,
        targetAddress: ADDRESS,
        nonce: 4,
        tokenAddress: TOKEN,
        amount: "100000",
        expiredAt: "",
        txnHash: TX,
      });
      if (recovery !== "direct") {
        vi.mocked(api.waitForSuccess).mockRejectedValue(
          new GasFreeTransactionStatusError("not confirmed", TX, false),
        );
      }
      if (recovery === "trace") {
        vi.mocked(api.waitForSuccess)
          .mockReset()
          .mockRejectedValueOnce(
            new GasFreeTransactionStatusError("no chain hash yet", undefined, false),
          )
          .mockResolvedValue({
            id: "trace-1",
            state: "SUCCEED",
            txnHash: TX,
          } as Awaited<ReturnType<typeof api.waitForSuccess>>);
      }
      if (recovery === "failed-trace") {
        vi.mocked(api.waitForSuccess).mockRejectedValue(
          new GasFreeTransactionStatusError("relayer rejected", undefined, true),
        );
      }
      const pendingSettlementStore = new InMemoryTronPendingSettlementStore();
      const saved = vi.spyOn(pendingSettlementStore, "set");
      const receipt = vi.fn(async () => ({
        status:
          recovery === "direct" || recovery === "trace" || recovery === "failed-trace"
            ? ("success" as const)
            : recovery,
      }));
      const base = await createFacilitatorTronSigner(
        { getAddress: () => ADDRESS, signTransaction: async () => ({}) },
        { network: NETWORK },
      );
      const facilitator = new x402Facilitator().register(
        NETWORK,
        new GasFacilitator(
          { ...base, waitForTransactionReceipt: receipt, readContract: async () => 10000000n },
          { [NETWORK]: api },
          { pendingSettlementStore },
        ),
      );
      const server = new x402ResourceServer({
        getSupported: async () => ({
          ...facilitator.getSupported(),
          kinds: facilitator.getSupported().kinds.map(kind => ({ ...kind, network: NETWORK })),
        }),
        verify: (p, r) => facilitator.verify(p, r),
        settle: (p, r) => facilitator.settle(p, r),
      }).register(NETWORK, new GasServer());
      await server.initialize();
      const accepts = await server.buildPaymentRequirements({
        scheme: "exact_gasfree",
        network: NETWORK,
        price: "0.1 USDT",
        payTo: ADDRESS,
        maxTimeoutSeconds: 600,
      });
      const client = new x402Client().register(
        NETWORK,
        new GasClient(
          { ...signer, readContract: async () => 10000000n },
          { apiClients: { [NETWORK]: api } },
        ),
      );
      const payment = await client.createPaymentPayload({ x402Version: 2, accepts, resource });
      expect(payment.payload).toMatchObject({
        gasfree: { nonce: "4", value: "100000", maxFee: "10000" },
      });
      expect(await server.verifyPayment(payment, accepts[0])).toMatchObject({ isValid: true });
      const result = await server.settlePayment(payment, accepts[0]);
      expect(result).toMatchObject({
        success: recovery === "direct" || recovery === "success",
        transaction: recovery === "trace" || recovery === "failed-trace" ? "" : TX,
        network: NETWORK,
      });
      if (recovery === "pending") expect(result.errorReason).toBe("settlement_pending");
      if (recovery === "failed-trace") {
        expect(result.errorReason).toBe("gasfree_transaction_failed");
        expect(await pendingSettlementStore.get(saved.mock.calls[0][0])).toBeUndefined();
      }
      if (recovery === "trace") {
        expect(result).toMatchObject({
          errorReason: "settlement_pending",
          extra: { gasfreeTraceId: "trace-1" },
        });
        expect(await server.settlePayment(payment, accepts[0])).toMatchObject({
          success: true,
          transaction: TX,
        });
      }
      expect(api.submit).toHaveBeenCalledTimes(1);
      expect(api.waitForSuccess).toHaveBeenCalledTimes(recovery === "trace" ? 2 : 1);
      expect(receipt).toHaveBeenCalledTimes(
        recovery === "direct" || recovery === "trace" || recovery === "failed-trace" ? 0 : 1,
      );
    },
  );
});
