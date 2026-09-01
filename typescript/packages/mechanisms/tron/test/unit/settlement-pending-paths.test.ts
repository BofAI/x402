import { describe, expect, it, vi } from "vitest";
import { utils as tronUtils } from "tronweb";
import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";
import type { FacilitatorTronSigner } from "../../src/signer";
import { settleEIP3009 } from "../../src/exact/facilitator/eip3009";
import { settlePermit2 } from "../../src/exact/facilitator/permit2";
import { settleUptoPermit2 } from "../../src/upto/facilitator/permit2";
import { executeClaimWithSignature } from "../../src/batch-settlement/facilitator/claim";
import { executeSettle } from "../../src/batch-settlement/facilitator/settle";
import { executeRefundWithSignature } from "../../src/batch-settlement/facilitator/refund";
import { computeChannelId } from "../../src/shared/batch-settlement/utils";
import {
  X402_PERMIT2_PROXY_ADDRESSES,
  X402_UPTO_PERMIT2_PROXY_ADDRESSES,
} from "../../src/constants";
import { normalizeAddressForSigning } from "../../src/utils";
import { BatchSettlementTronScheme } from "../../src/batch-settlement/facilitator/scheme";
import type { TronBatchSettlementReconciliationContextV1 } from "../../src/reconciliation";

const NETWORK = "tron:0xcd8690dc";
const TX = "ef".repeat(32);
const PAYER = `0x${"11".repeat(20)}` as `0x${string}`;
const RECEIVER = `0x${"22".repeat(20)}` as `0x${string}`;
const TOKEN = `0x${"33".repeat(20)}` as `0x${string}`;

function pendingSigner(
  readContract: FacilitatorTronSigner["readContract"] = vi.fn(async () => 1_000_000n),
): FacilitatorTronSigner {
  return {
    getAddresses: () => [PAYER],
    readContract,
    verifyTypedData: vi.fn(async () => true),
    writeContract: vi.fn(async () => TX),
    waitForTransactionReceipt: vi.fn(async () => ({ status: "pending" })),
  };
}

const requirements = {
  scheme: "batch-settlement",
  network: NETWORK,
  asset: TOKEN,
  amount: "100",
  payTo: RECEIVER,
  maxTimeoutSeconds: 600,
  extra: {},
} as unknown as PaymentRequirements;

describe("TRON settlement paths preserve pending txids", () => {
  it("maps exact EIP-3009 pending without rebroadcasting", async () => {
    const signer = pendingSigner();
    const exactRequirements = {
      ...requirements,
      scheme: "exact",
      extra: { name: "Token", version: "1", assetTransferMethod: "eip3009" },
    } as PaymentRequirements;
    const tronPayload = {
      signature: `0x${"44".repeat(65)}` as `0x${string}`,
      authorization: {
        from: PAYER,
        to: RECEIVER,
        value: "100",
        validAfter: "0",
        validBefore: String(Math.floor(Date.now() / 1000) + 600),
        nonce: `0x${"55".repeat(32)}` as `0x${string}`,
      },
    };
    const payment = {
      x402Version: 2,
      accepted: exactRequirements,
      payload: tronPayload,
    } as unknown as PaymentPayload;

    const result = await settleEIP3009(signer, payment, exactRequirements, tronPayload);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
    expect(signer.writeContract).toHaveBeenCalledTimes(1);
    expect(signer.waitForTransactionReceipt).toHaveBeenCalledTimes(1);
  });

  it("maps exact Permit2 pending", async () => {
    const signer = pendingSigner();
    const exactRequirements = {
      ...requirements,
      scheme: "exact",
      extra: { assetTransferMethod: "permit2" },
    } as PaymentRequirements;
    const permit2Payload = {
      signature: `0x${"44".repeat(65)}` as `0x${string}`,
      permit2Authorization: {
        from: PAYER,
        permitted: { token: TOKEN, amount: "100" },
        spender: normalizeAddressForSigning(X402_PERMIT2_PROXY_ADDRESSES[NETWORK]),
        nonce: "1",
        deadline: String(Math.floor(Date.now() / 1000) + 600),
        witness: { to: RECEIVER, validAfter: "0" },
      },
    };
    const payment = {
      x402Version: 2,
      accepted: exactRequirements,
      payload: permit2Payload,
    } as unknown as PaymentPayload;

    const result = await settlePermit2(signer, payment, exactRequirements, permit2Payload);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
  });

  it("maps upto Permit2 pending", async () => {
    const signer = pendingSigner();
    const uptoRequirements = {
      ...requirements,
      scheme: "upto",
      amount: "40",
      extra: { assetTransferMethod: "permit2", permit2FacilitatorAddress: PAYER },
    } as PaymentRequirements;
    const acceptedRequirements = { ...uptoRequirements, amount: "100" } as PaymentRequirements;
    const permit2Payload = {
      signature: `0x${"44".repeat(65)}` as `0x${string}`,
      permit2Authorization: {
        from: PAYER,
        permitted: { token: TOKEN, amount: "100" },
        spender: normalizeAddressForSigning(X402_UPTO_PERMIT2_PROXY_ADDRESSES[NETWORK]),
        nonce: "1",
        deadline: String(Math.floor(Date.now() / 1000) + 600),
        witness: { to: RECEIVER, facilitator: PAYER, validAfter: "0" },
      },
    };
    const payment = {
      x402Version: 2,
      accepted: acceptedRequirements,
      payload: permit2Payload,
    } as unknown as PaymentPayload;

    const result = await settleUptoPermit2(signer, payment, uptoRequirements, permit2Payload);

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
    });
    expect(result.amount).toBeUndefined();
  });

  it("maps batch claim pending", async () => {
    const signer = pendingSigner();
    const result = await executeClaimWithSignature(
      signer,
      {
        type: "claim",
        claims: [],
        claimAuthorizerSignature: `0x${"66".repeat(65)}`,
      },
      requirements,
      undefined,
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
      extra: {
        reconciliationContext: {
          scheme: "batch-settlement",
          operation: "claim",
        },
      },
    });
  });

  it("reconciles a persisted batch claim context without broadcasting", async () => {
    const broadcastSigner = pendingSigner();
    const pending = await executeClaimWithSignature(
      broadcastSigner,
      {
        type: "claim",
        claims: [],
        claimAuthorizerSignature: `0x${"66".repeat(65)}`,
      },
      requirements,
      undefined,
    );
    const context = pending.extra
      ?.reconciliationContext as TronBatchSettlementReconciliationContextV1;
    const write = vi.mocked(broadcastSigner.writeContract).mock.calls[0]![0];
    const iface = new tronUtils.ethersUtils.Interface(write.abi);
    const target = normalizeAddressForSigning(write.address);
    const reconciliationSigner = pendingSigner();
    vi.mocked(reconciliationSigner.writeContract).mockRejectedValue(
      new Error("reconciliation must not broadcast"),
    );
    vi.mocked(reconciliationSigner.waitForTransactionReceipt).mockResolvedValue({
      status: "success",
      finality: "solidified",
      call: {
        contractAddress: `41${target.slice(2)}`,
        data: iface.encodeFunctionData(write.functionName, [...write.args]).replace(/^0x/, ""),
      },
      logs: [],
    });
    const scheme = new BatchSettlementTronScheme(reconciliationSigner);

    const result = await scheme.reconcile(TX, context);

    expect(result).toMatchObject({ success: true, transaction: TX, amount: "" });
    expect(reconciliationSigner.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: TX,
      finality: "solidified",
    });
    expect(reconciliationSigner.writeContract).not.toHaveBeenCalled();
  });

  it("maps batch settle pending without performing the post-receipt read", async () => {
    const readContract = vi.fn(async () => [100n, 0n]);
    const signer = pendingSigner(readContract);

    const result = await executeSettle(
      signer,
      { type: "settle", receiver: RECEIVER, token: TOKEN },
      requirements,
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
      extra: {
        reconciliationContext: {
          scheme: "batch-settlement",
          operation: "settle",
        },
      },
    });
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it("derives the batch settle amount from a validated Settled event", async () => {
    let write: Parameters<FacilitatorTronSigner["writeContract"]>[0] | undefined;
    const signer: FacilitatorTronSigner = {
      getAddresses: () => [PAYER],
      readContract: vi.fn(async () => [100n, 0n]),
      verifyTypedData: vi.fn(async () => true),
      writeContract: vi.fn(async args => {
        write = args;
        return TX;
      }),
      waitForTransactionReceipt: vi.fn(async () => {
        const call = write!;
        const target = normalizeAddressForSigning(call.address);
        const receiver = normalizeAddressForSigning(RECEIVER);
        const token = normalizeAddressForSigning(TOKEN);
        const iface = new tronUtils.ethersUtils.Interface(call.abi);
        const settledTopic = tronUtils.ethersUtils
          .keccak256(tronUtils.ethersUtils.toUtf8Bytes("Settled(address,address,address,uint128)"))
          .replace(/^0x/, "");
        return {
          status: "success" as const,
          finality: "packed" as const,
          call: {
            contractAddress: `41${target.slice(2)}`,
            data: iface.encodeFunctionData(call.functionName, [...call.args]).replace(/^0x/, ""),
          },
          logs: [
            {
              address: target.slice(2),
              topics: [
                settledTopic,
                receiver.slice(2).padStart(64, "0"),
                token.slice(2).padStart(64, "0"),
                normalizeAddressForSigning(PAYER).slice(2).padStart(64, "0"),
              ],
              data: BigInt(100).toString(16).padStart(64, "0"),
            },
          ],
        };
      }),
    };

    const result = await executeSettle(
      signer,
      { type: "settle", receiver: RECEIVER, token: TOKEN },
      requirements,
    );

    expect(result).toMatchObject({
      success: true,
      transaction: TX,
      amount: "100",
      extra: {
        reconciliationContext: {
          scheme: "batch-settlement",
          operation: "settle",
        },
      },
    });
    expect(signer.readContract).toHaveBeenCalledTimes(1);
  });

  it("maps batch refund pending", async () => {
    const readContract = vi.fn(async args => {
      if (args.functionName === "channels") return [100n, 0n];
      if (args.functionName === "pendingWithdrawals") return [0n, 0n];
      if (args.functionName === "refundNonce") return 0n;
      throw new Error(`unexpected read ${args.functionName}`);
    });
    const signer = pendingSigner(readContract);
    const channelConfig = {
      payer: PAYER,
      payerAuthorizer: PAYER,
      receiver: RECEIVER,
      receiverAuthorizer: RECEIVER,
      token: TOKEN,
      withdrawDelay: 900,
      salt: `0x${"77".repeat(32)}` as `0x${string}`,
    };
    const channelId = computeChannelId(channelConfig, NETWORK);

    const result = await executeRefundWithSignature(
      signer,
      {
        type: "refund",
        channelConfig,
        voucher: {
          channelId,
          maxClaimableAmount: "0",
          signature: `0x${"88".repeat(65)}`,
        },
        amount: "10",
        refundNonce: "0",
        claims: [],
        refundAuthorizerSignature: `0x${"99".repeat(65)}`,
      },
      requirements,
      undefined,
    );

    expect(result).toMatchObject({
      success: false,
      errorReason: "settlement_pending",
      transaction: TX,
      payer: PAYER,
      extra: {
        reconciliationContext: {
          scheme: "batch-settlement",
          operation: "refund",
        },
      },
    });
  });
});
