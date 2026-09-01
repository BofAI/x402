import { describe, expect, it, vi } from "vitest";
import { utils as tronUtils } from "tronweb";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import type { FacilitatorTronSigner, TronTransactionReceipt } from "../../src/signer";
import { transferWithAuthorizationABI } from "../../src/constants";
import {
  createTronSettlementReconciliationContext,
  parseTronSettlementReconciliationContext,
  reconcileTronSettlement,
} from "../../src/reconciliation";
import { ExactTronScheme } from "../../src/exact/facilitator/scheme";
import { settleEIP3009 } from "../../src/exact/facilitator/eip3009";

const NETWORK = "tron:0xcd8690dc";
const TX = "ab".repeat(32);
const PAYER = `0x${"11".repeat(20)}` as `0x${string}`;
const RECEIVER = `0x${"22".repeat(20)}` as `0x${string}`;
const TOKEN = `0x${"33".repeat(20)}` as `0x${string}`;
const NONCE = `0x${"44".repeat(32)}` as `0x${string}`;
const SIGNATURE = `0x${"55".repeat(32)}${"66".repeat(32)}01` as `0x${string}`;
const TRANSFER_TOPIC = "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const requirements = {
  scheme: "exact",
  network: NETWORK,
  asset: TOKEN,
  amount: "100",
  payTo: RECEIVER,
  maxTimeoutSeconds: 600,
  extra: { name: "Token", version: "1", assetTransferMethod: "eip3009" },
} as PaymentRequirements;

const tronPayload = {
  signature: SIGNATURE,
  authorization: {
    from: PAYER,
    to: RECEIVER,
    value: "100",
    validAfter: "0",
    validBefore: "9999999999",
    nonce: NONCE,
  },
};

const payment = {
  x402Version: 2,
  accepted: requirements,
  payload: tronPayload,
} as unknown as PaymentPayload;

function encodedCallData(): string {
  const iface = new tronUtils.ethersUtils.Interface(transferWithAuthorizationABI);
  return iface
    .encodeFunctionData("transferWithAuthorization", [
      PAYER,
      RECEIVER,
      100n,
      0n,
      9_999_999_999n,
      NONCE,
      1,
      `0x${"55".repeat(32)}`,
      `0x${"66".repeat(32)}`,
    ])
    .replace(/^0x/, "");
}

function transferLog(amount = 100n) {
  return {
    address: TOKEN.slice(2),
    topics: [TRANSFER_TOPIC, PAYER.slice(2).padStart(64, "0"), RECEIVER.slice(2).padStart(64, "0")],
    data: amount.toString(16).padStart(64, "0"),
  };
}

function receipt(overrides: Partial<TronTransactionReceipt> = {}): TronTransactionReceipt {
  return {
    status: "success",
    finality: "solidified",
    call: {
      contractAddress: `41${TOKEN.slice(2)}`,
      data: encodedCallData(),
    },
    logs: [transferLog()],
    ...overrides,
  };
}

function signerWith(result: TronTransactionReceipt): FacilitatorTronSigner {
  return {
    getAddresses: () => [PAYER],
    readContract: vi.fn(),
    verifyTypedData: vi.fn(),
    writeContract: vi.fn(async () => {
      throw new Error("reconciliation must not broadcast");
    }),
    waitForTransactionReceipt: vi.fn(async () => result),
    getTransactionReceipt: vi.fn(async () => result),
  };
}

describe("TRON settlement reconciliation", () => {
  it("builds a versioned scheme-aware validation context", () => {
    const context = createTronSettlementReconciliationContext(payment, requirements);

    expect(context).toMatchObject({
      version: 1,
      scheme: "exact",
      transferMethod: "eip3009",
      network: NETWORK,
      payer: PAYER,
      asset: TOKEN,
      payTo: RECEIVER,
      amount: "100",
      call: { target: TOKEN },
      transfer: { token: TOKEN, from: PAYER, to: RECEIVER, amount: "100" },
    });
    expect(context.call.calldataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("rejects a reconciliation context whose accepted scheme does not match", () => {
    const mismatchedPayment = {
      ...payment,
      accepted: { ...payment.accepted, scheme: "upto" },
    } as PaymentPayload;

    expect(() =>
      createTronSettlementReconciliationContext(mismatchedPayment, requirements),
    ).toThrow("payment/reconciliation scheme mismatch");
  });

  it("runtime-parses a persisted version-1 reconciliation context", () => {
    const context = createTronSettlementReconciliationContext(payment, requirements);
    const persisted = JSON.parse(JSON.stringify(context)) as unknown;

    expect(parseTronSettlementReconciliationContext(persisted)).toEqual(context);
  });

  it("rejects unsupported persisted context versions before reading the chain", async () => {
    const signer = signerWith(receipt());
    const context = {
      ...createTronSettlementReconciliationContext(payment, requirements),
      version: 2,
    };

    await expect(reconcileTronSettlement(signer, TX, context)).rejects.toThrow(
      "unsupported TRON reconciliation context version: 2",
    );
    expect(signer.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects malformed nested fields in a persisted reconciliation context", () => {
    const context = createTronSettlementReconciliationContext(payment, requirements);

    expect(() =>
      parseTronSettlementReconciliationContext({
        ...context,
        call: { ...context.call, calldataHash: "not-a-digest" },
      }),
    ).toThrow("call.calldataHash must be a 32-byte hex digest");
  });

  it("uses only the solidified read path and returns success after effect validation", async () => {
    const signer = signerWith(receipt());
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: true,
      transaction: TX,
      network: NETWORK,
      payer: PAYER,
      amount: "100",
    });
    expect(signer.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(signer.getTransactionReceipt).toHaveBeenCalledWith({
      hash: TX,
      finality: "solidified",
      timeoutMs: 10_000,
    });
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("passes the worker's per-attempt timeout to the one-shot reader", async () => {
    const signer = signerWith(receipt({ status: "pending", call: undefined, logs: undefined }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context, { timeoutMs: 750 });

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
    expect(signer.getTransactionReceipt).toHaveBeenCalledTimes(1);
    expect(signer.getTransactionReceipt).toHaveBeenCalledWith({
      hash: TX,
      finality: "solidified",
      timeoutMs: 750,
    });
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects an invalid per-attempt timeout before reading the chain", async () => {
    const signer = signerWith(receipt());
    const context = createTronSettlementReconciliationContext(payment, requirements);

    await expect(reconcileTronSettlement(signer, TX, context, { timeoutMs: 0 })).rejects.toThrow(
      "reconciliation timeoutMs must be a positive integer",
    );
    expect(signer.getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("bounds a custom one-shot reader that ignores the timeout option", async () => {
    vi.useFakeTimers();
    try {
      const signer = signerWith(receipt());
      vi.mocked(signer.getTransactionReceipt!).mockImplementation(
        async () => new Promise<never>(() => undefined),
      );
      const context = createTronSettlementReconciliationContext(payment, requirements);

      const resultPromise = reconcileTronSettlement(signer, TX, context, { timeoutMs: 500 });
      const expectation = expect(resultPromise).resolves.toMatchObject({
        success: false,
        errorReason: "settlement_pending",
        errorMessage: "TRON reconciliation receipt query timed out",
        transaction: TX,
      });
      await vi.advanceTimersByTimeAsync(500);

      await expectation;
      expect(signer.getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("propagates worker cancellation without converting it to pending", async () => {
    vi.useFakeTimers();
    try {
      const signer = signerWith(receipt());
      vi.mocked(signer.getTransactionReceipt!).mockImplementation(
        async () => new Promise<never>(() => undefined),
      );
      const context = createTronSettlementReconciliationContext(payment, requirements);
      const controller = new AbortController();

      const resultPromise = reconcileTronSettlement(signer, TX, context, {
        signal: controller.signal,
      });
      const expectation = expect(resultPromise).rejects.toThrow("worker shutdown");
      controller.abort(new Error("worker shutdown"));

      await expectation;
      expect(signer.getTransactionReceipt).toHaveBeenCalledTimes(1);
      expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes scheme-aware reconciliation on the exact facilitator", async () => {
    const signer = signerWith(receipt());
    const scheme = new ExactTronScheme(signer);
    const persistedContext = JSON.parse(
      JSON.stringify(createTronSettlementReconciliationContext(payment, requirements)),
    );

    const result = await scheme.reconcile(TX, persistedContext);

    expect(result).toMatchObject({ success: true, transaction: TX, amount: "100" });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it("keeps a packed result pending during reconciliation", async () => {
    const signer = signerWith(receipt({ finality: "packed" }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
  });

  it("fails a solidified transaction whose target call does not match", async () => {
    const signer = signerWith(
      receipt({
        call: { contractAddress: `41${"99".repeat(20)}`, data: encodedCallData() },
      }),
    );
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "invalid_transaction_effect",
      transaction: TX,
    });
  });

  it("applies the same call/effect validation to the packed exact success path", async () => {
    const signer = signerWith(
      receipt({
        finality: "packed",
        call: { contractAddress: `41${"99".repeat(20)}`, data: encodedCallData() },
      }),
    );
    vi.mocked(signer.verifyTypedData).mockResolvedValue(true);
    vi.mocked(signer.readContract).mockResolvedValue(1_000n);
    vi.mocked(signer.writeContract).mockResolvedValue(TX);

    const result = await settleEIP3009(signer, payment, requirements, tronPayload);

    expect(result).toMatchObject({
      success: false,
      errorReason: "invalid_transaction_effect",
      transaction: TX,
    });
  });

  it("fails a solidified transaction whose Transfer effect does not match", async () => {
    const signer = signerWith(receipt({ logs: [transferLog(99n)] }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "invalid_transaction_effect",
      transaction: TX,
    });
  });

  it("keeps incomplete solidified data pending", async () => {
    const signer = signerWith(receipt({ call: undefined }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
  });

  it.each([
    {
      name: "missing Transfer log address",
      logs: [{ topics: transferLog().topics, data: transferLog().data }],
    },
    {
      name: "malformed Transfer topic",
      logs: [
        {
          ...transferLog(),
          topics: [TRANSFER_TOPIC, "not-hex", RECEIVER.slice(2).padStart(64, "0")],
        },
      ],
    },
    {
      name: "malformed Transfer data",
      logs: [{ ...transferLog(), data: "not-hex" }],
    },
  ])("keeps $name indeterminate instead of terminalizing it", async ({ logs }) => {
    const signer = signerWith(receipt({ logs }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
  });

  it("treats a complete solidified receipt with no Transfer event as a definite mismatch", async () => {
    const signer = signerWith(receipt({ logs: [] }));
    const context = createTronSettlementReconciliationContext(payment, requirements);

    const result = await reconcileTronSettlement(signer, TX, context);

    expect(result).toMatchObject({
      success: false,
      errorReason: "invalid_transaction_effect",
      transaction: TX,
    });
  });
});
