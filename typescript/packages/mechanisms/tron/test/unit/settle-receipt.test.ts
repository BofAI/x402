import { describe, expect, it, vi } from "vitest";
import { SETTLEMENT_PENDING, waitAndReturnSettleResponse } from "../../src/shared/settleReceipt";

const TX = "ab".repeat(32);
const NETWORK = "tron:0xcd8690dc" as never;
const FAILED = "scheme_specific_transaction_failed";

function signerWith(receipt: unknown, error?: Error) {
  return {
    waitForTransactionReceipt: vi.fn(async () => {
      if (error) throw error;
      return receipt;
    }),
  } as any;
}

describe("TRON settlement receipt terminal/pending boundary", () => {
  it("fails terminally without polling when the broadcast txid is invalid", async () => {
    const signer = signerWith({ status: "success" });
    const result = await waitAndReturnSettleResponse(signer, "not-a-txid", NETWORK, undefined, {
      failedStatusReason: FAILED,
    });

    expect(result).toMatchObject({
      success: false,
      errorReason: FAILED,
      transaction: "",
    });
    expect(signer.waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it("rejects an all-zero placeholder txid", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith({ status: "pending" }),
      "00".repeat(32),
      NETWORK,
      undefined,
      { failedStatusReason: FAILED },
    );

    expect(result).toMatchObject({ success: false, errorReason: FAILED, transaction: "" });
  });

  it("preserves the txid when the signer reports pending", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith({ status: "pending" }),
      TX,
      NETWORK,
      "payer",
      { failedStatusReason: FAILED },
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: SETTLEMENT_PENDING,
      transaction: TX,
      payer: "payer",
    });
  });

  it("preserves the txid when receipt waiting throws", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith(undefined, new Error("rpc unavailable")),
      TX,
      NETWORK,
      undefined,
      { failedStatusReason: FAILED },
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: SETTLEMENT_PENDING,
      errorMessage: "rpc unavailable",
      transaction: TX,
    });
  });

  it("keeps an explicit revert terminal", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith({ status: "reverted" }),
      TX,
      NETWORK,
      undefined,
      { failedStatusReason: FAILED },
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: FAILED,
      transaction: TX,
    });
  });

  it("returns pending when asynchronous success processing rejects", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith({ status: "success" }),
      TX,
      NETWORK,
      undefined,
      {
        failedStatusReason: FAILED,
        onSuccess: async () => {
          throw new Error("post-state unavailable");
        },
      },
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: SETTLEMENT_PENDING,
      errorMessage: "post-state unavailable",
      transaction: TX,
    });
  });

  it("bounds receipt errors returned through the protocol response", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith(undefined, new Error("x".repeat(300))),
      TX,
      NETWORK,
      undefined,
    );

    expect(result.errorMessage).toHaveLength(256);
  });

  it("returns the scheme success response after confirmation", async () => {
    const result = await waitAndReturnSettleResponse(
      signerWith({ status: "success" }),
      TX,
      NETWORK,
      "payer",
      { failedStatusReason: FAILED, amount: "100" },
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX,
      payer: "payer",
      amount: "100",
    });
  });
});
