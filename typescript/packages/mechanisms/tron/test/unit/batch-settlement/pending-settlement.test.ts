import { afterEach, describe, expect, it, vi } from "vitest";
import { x402Facilitator } from "@x402/core/facilitator";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";
import { BatchSettlementTronScheme as BatchFacilitator } from "../../../src/batch-settlement/facilitator";
import { BatchSettlementTronScheme as BatchServer } from "../../../src/batch-settlement/server";
import { BatchSettlementChannelManager } from "../../../src/batch-settlement/server/channelManager";
import { InMemoryChannelStorage } from "../../../src/batch-settlement/server/storage";
import { InMemoryTronPendingSettlementStore } from "../../../src/shared/pendingSettlement";
import { computeChannelId } from "../../../src/shared/batch-settlement/utils";
import type { FacilitatorTronSigner } from "../../../src/signer";

const NETWORK = "tron:3448148188";
const RECEIVER = `0x${"22".repeat(20)}` as const;
const TOKEN = `0x${"33".repeat(20)}` as const;
const requirements: PaymentRequirements = {
  scheme: "batch-settlement",
  network: NETWORK,
  asset: TOKEN,
  amount: "0",
  payTo: RECEIVER,
  maxTimeoutSeconds: 0,
  extra: {},
};
const payment: PaymentPayload = {
  x402Version: 2,
  accepted: requirements,
  payload: { type: "settle", receiver: RECEIVER, token: TOKEN },
};

// Model only RPC state transitions. The facilitator, shared store, claim queue,
// channel storage, and interval runner all use their production implementations.
function fixture() {
  let claimed = 0n;
  let settled = 0n;
  let nextId = 0;
  let delaySettlement = false;
  let beforeSettlement: (() => Promise<void>) | undefined;
  const transactions = new Map<string, { pending: boolean }>();
  const settlements: string[] = [];
  const signer: FacilitatorTronSigner = {
    getAddresses: () => [RECEIVER],
    verifyTypedData: async () => true,
    readContract: async ({ functionName }) => {
      if (functionName === "receivers") return [claimed, settled];
      throw new Error(`unexpected read: ${functionName}`);
    },
    writeContract: async ({ functionName, args }) => {
      const tx = (++nextId).toString(16).padStart(64, "0");
      if (functionName === "claimWithSignature") {
        const claims = args![0] as unknown as Array<[unknown, unknown, bigint]>;
        claimed = claims[0][2];
      } else if (functionName === "settle") {
        await beforeSettlement?.();
        beforeSettlement = undefined;
        settled = claimed;
        settlements.push(tx);
      } else {
        throw new Error(`unexpected write: ${functionName}`);
      }
      transactions.set(tx, { pending: functionName === "settle" && delaySettlement });
      if (functionName === "settle") delaySettlement = false;
      return tx;
    },
    waitForTransactionReceipt: async ({ hash }) => ({
      status: transactions.get(hash)!.pending ? "pending" : "success",
    }),
  };
  const store = new InMemoryTronPendingSettlementStore();
  const createFacilitator = () =>
    new BatchFacilitator(signer, undefined, { pendingSettlementStore: store });
  return {
    createFacilitator,
    settlements,
    claim: (amount: bigint) => {
      claimed += amount;
    },
    outstanding: () => claimed - settled,
    confirm: () => {
      for (const tx of transactions.values()) tx.pending = false;
    },
    beforeNextSettlement: (action: () => Promise<void>) => {
      beforeSettlement = action;
    },
    delayNextSettlement: () => {
      delaySettlement = true;
    },
  };
}

async function channelManager(
  f: ReturnType<typeof fixture>,
  afterSettle?: (response: SettleResponse) => Promise<void>,
) {
  const scheme = f.createFacilitator();
  const core = new x402Facilitator().register(NETWORK, scheme);
  const storage = new InMemoryChannelStorage();
  const config = {
    payer: `0x${"11".repeat(20)}` as const,
    payerAuthorizer: `0x${"11".repeat(20)}` as const,
    receiver: RECEIVER,
    receiverAuthorizer: RECEIVER,
    token: TOKEN,
    withdrawDelay: 900,
    salt: `0x${"44".repeat(32)}` as const,
  };
  const channelId = computeChannelId(config, NETWORK);
  await storage.updateChannel(channelId, () => ({
    channelId,
    channelConfig: config,
    chargedCumulativeAmount: "100",
    signedMaxClaimable: "200",
    signature: `0x${"55".repeat(65)}`,
    balance: "200",
    totalClaimed: "0",
    withdrawRequestedAt: 0,
    refundNonce: 0,
    lastRequestTimestamp: 0,
  }));
  const server = new BatchServer(RECEIVER, {
    storage,
    receiverAuthorizerSigner: {
      address: RECEIVER,
      signTypedData: async () => `0x${"66".repeat(65)}`,
    },
  });
  const manager = new BatchSettlementChannelManager({
    scheme: server,
    receiver: RECEIVER,
    token: TOKEN,
    network: NETWORK,
    facilitator: {
      settle: async (payload, reqs) => {
        const response = await core.settle(payload, reqs);
        if (payload.payload.type === "settle") await afterSettle?.(response);
        return response;
      },
      verify: (payload, reqs) => core.verify(payload, reqs),
      getSupported: async () => core.getSupported(),
    },
  });
  return { manager, storage, channelId };
}

afterEach(() => vi.useRealTimers());

describe("batch pending settlement recovery", () => {
  it.each(["original", "recovering", "fresh"] as const)(
    "settles a new claim on the %s instance after another instance clears the old transaction",
    async instance => {
      const f = fixture();
      const a = f.createFacilitator();
      const b = f.createFacilitator();
      f.claim(100n);
      f.delayNextSettlement();
      expect(await a.settle(payment, requirements)).toMatchObject({
        errorReason: "settlement_pending",
      });
      f.confirm();
      expect(await b.settle(payment, requirements)).toMatchObject({ success: true });
      f.claim(100n);

      const target =
        instance === "original" ? a : instance === "recovering" ? b : f.createFacilitator();
      expect(await target.settle(payment, requirements)).toMatchObject({
        success: true,
        amount: "100",
      });
      expect(f.outstanding()).toBe(0n);
      expect(f.settlements).toHaveLength(2);
    },
  );

  it.each(["scheduled", "flush"] as const)(
    "drains claims added while an earlier settlement awaited recovery through %s jobs",
    async mode => {
      vi.useFakeTimers();
      const f = fixture();
      const { manager, storage, channelId } = await channelManager(f);
      const errors: unknown[] = [];
      manager.start({
        claimIntervalSecs: 1,
        settleIntervalSecs: 1,
        onError: error => errors.push(error),
      });
      try {
        f.delayNextSettlement();
        await vi.advanceTimersByTimeAsync(1000);
        f.confirm();
        await storage.updateChannel(channelId, current => ({
          ...current!,
          chargedCumulativeAmount: "200",
        }));
        await manager.claim();
        expect(f.outstanding()).toBe(100n);

        if (mode === "flush") await manager.stop({ flush: true });
        else await vi.advanceTimersByTimeAsync(2000);

        expect(f.outstanding()).toBe(0n);
        expect(f.settlements).toHaveLength(2);
        expect(errors).toHaveLength(1);
        expect(String(errors[0])).toContain("settlement_pending");
        expect(await storage.get(channelId)).toMatchObject({ totalClaimed: "200" });
      } finally {
        await manager.stop();
      }
    },
  );

  it("keeps scheduling a claim completed while the earlier settle response was in flight", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let release!: () => void;
    let responseReady!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = new Promise<void>(resolve => {
      responseReady = resolve;
    });
    let first = true;
    const { manager, storage, channelId } = await channelManager(f, async response => {
      if (response.success && first) {
        first = false;
        responseReady();
        await blocked;
      }
    });
    const errors: unknown[] = [];
    manager.start({ settleIntervalSecs: 1, onError: error => errors.push(error) });
    try {
      await manager.claim();
      const settling = manager.settle();
      await ready;
      await storage.updateChannel(channelId, current => ({
        ...current!,
        chargedCumulativeAmount: "200",
      }));
      await manager.claim();
      release();
      await settling;
      await vi.advanceTimersByTimeAsync(1000);
      expect(f.outstanding()).toBe(0n);
      expect(f.settlements).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally {
      release();
      await manager.stop();
    }
  });

  it.each(["scheduled", "flush"] as const)(
    "reconciles an already drained balance without errors through %s jobs",
    async mode => {
      vi.useFakeTimers();
      const f = fixture();
      const { manager, storage, channelId } = await channelManager(f);
      let release!: () => void;
      let broadcastReady!: () => void;
      const blocked = new Promise<void>(resolve => {
        release = resolve;
      });
      const ready = new Promise<void>(resolve => {
        broadcastReady = resolve;
      });
      f.beforeNextSettlement(async () => {
        broadcastReady();
        await blocked;
      });
      const errors: unknown[] = [];
      manager.start({ settleIntervalSecs: 1, onError: error => errors.push(error) });
      try {
        await manager.claim();
        const settling = manager.settle();
        await ready;
        await storage.updateChannel(channelId, current => ({
          ...current!,
          chargedCumulativeAmount: "200",
        }));
        await manager.claim();
        release();
        await settling;
        if (mode === "flush") await manager.stop({ flush: true });
        else await vi.advanceTimersByTimeAsync(2000);
        expect(f.outstanding()).toBe(0n);
        expect(f.settlements).toHaveLength(1);
        expect(errors).toEqual([]);
      } finally {
        release();
        await manager.stop();
      }
    },
  );

  it("flushes an already drained balance while an earlier settle response is in flight", async () => {
    const f = fixture();
    let release!: () => void;
    let responseReady!: () => void;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const ready = new Promise<void>(resolve => {
      responseReady = resolve;
    });
    let settling: Promise<unknown>;
    const { manager } = await channelManager(f, async response => {
      if (response.success) {
        responseReady();
        await blocked;
      } else {
        release();
        await settling;
      }
    });
    try {
      await manager.claim();
      settling = manager.settle();
      await ready;
      await manager.stop({ flush: true });
      expect(f.outstanding()).toBe(0n);
      expect(f.settlements).toHaveLength(1);
    } finally {
      release();
      await manager.stop();
    }
  });
});
