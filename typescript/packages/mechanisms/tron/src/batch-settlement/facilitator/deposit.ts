import {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import { batchSettlementABI, erc20BalanceOfABI } from "../../shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../shared/batch-settlement/constants";
import { BatchSettlementAssetTransferMethod, BatchSettlementDepositPayload } from "../types";
import {
  readChannelState,
  toBigInt,
  toContractChannelConfig,
  validateChannelConfig,
  verifyBatchSettlementVoucherTypedData,
} from "./utils";
import {
  buildEip3009DepositCollectorData,
  getEip3009DepositCollectorAddress,
  verifyEip3009DepositAuthorization,
} from "./deposit-eip3009";
import {
  buildPermit2DepositCollectorData,
  getPermit2DepositCollectorAddress,
  verifyPermit2DepositAuthorization,
} from "./deposit-permit2";
import * as Errors from "../errors";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];

type DepositExecution = { collector: string; collectorData: `0x${string}` };

/**
 * Selects the transfer method from requirements, falling back to payload shape.
 *
 * @param payload - Batch deposit payload.
 * @param requirements - Payment requirements for the request.
 * @returns Selected batch-settlement transfer method.
 */
function resolveDepositTransferMethod(
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
): BatchSettlementAssetTransferMethod {
  const hinted = (
    requirements.extra as { assetTransferMethod?: BatchSettlementAssetTransferMethod }
  )?.assetTransferMethod;
  if (hinted) return hinted;
  return payload.deposit.authorization.permit2Authorization ? "permit2" : "eip3009";
}

/**
 * Resolves the collector address and collector data for a deposit payload.
 *
 * @param payload - Batch deposit payload.
 * @param requirements - Payment requirements for the request.
 * @returns Collector address and encoded collector data.
 */
function resolveDepositExecution(
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
): DepositExecution {
  const method = resolveDepositTransferMethod(payload, requirements);
  if (method === "permit2") {
    return {
      collector: getPermit2DepositCollectorAddress(requirements.network),
      collectorData: buildPermit2DepositCollectorData(payload),
    };
  }
  return {
    collector: getEip3009DepositCollectorAddress(requirements.network),
    collectorData: buildEip3009DepositCollectorData(payload),
  };
}

/**
 * Verifies a deposit payload (authorization + voucher) without executing any
 * onchain transaction.
 *
 * @param signer - Facilitator signer for onchain reads and signature verification.
 * @param payment - Full payment envelope (unused; reserved for interface parity).
 * @param payload - The full deposit payload.
 * @param requirements - Server payment requirements.
 * @returns A {@link VerifyResponse} with channel state in `extra` on success.
 */
export async function verifyDeposit(
  signer: FacilitatorTronSigner,
  payment: PaymentPayload,
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
): Promise<VerifyResponse> {
  void payment;
  const network = requirements.network;
  const config = payload.channelConfig;
  const payer = config.payer;

  const configErr = validateChannelConfig(config, payload.voucher.channelId, requirements);
  if (configErr) {
    return { isValid: false, invalidReason: configErr, payer };
  }

  const transferMethod = resolveDepositTransferMethod(payload, requirements);
  if (transferMethod === "permit2" && !payload.deposit.authorization.permit2Authorization) {
    return { isValid: false, invalidReason: Errors.ErrInvalidPayloadType, payer };
  }

  const methodErr =
    transferMethod === "permit2"
      ? await verifyPermit2DepositAuthorization(signer, payload, requirements, network)
      : await verifyEip3009DepositAuthorization(signer, payload, requirements, network);
  if (methodErr) {
    return methodErr;
  }

  const voucherOk = await verifyBatchSettlementVoucherTypedData(
    signer,
    {
      channelId: payload.voucher.channelId,
      maxClaimableAmount: payload.voucher.maxClaimableAmount,
      payerAuthorizer: config.payerAuthorizer,
      payer: config.payer,
      signature: payload.voucher.signature,
    },
    network,
  );
  if (!voucherOk) {
    return { isValid: false, invalidReason: Errors.ErrInvalidVoucherSignature, payer };
  }

  const state = await readChannelState(signer, payload.voucher.channelId, network);
  const depositAmount = BigInt(payload.deposit.amount);

  const payerBalance = toBigInt(
    await signer.readContract({
      address: requirements.asset,
      abi: erc20BalanceOfABI as unknown as readonly Record<string, unknown>[],
      functionName: "balanceOf",
      args: [normalizeAddressForSigning(payer)],
    }),
  );
  if (payerBalance < depositAmount) {
    return { isValid: false, invalidReason: Errors.ErrInsufficientBalance, payer };
  }

  const effectiveBalance = state.balance + depositAmount;
  const maxClaimableAmount = BigInt(payload.voucher.maxClaimableAmount);
  if (maxClaimableAmount > effectiveBalance) {
    return { isValid: false, invalidReason: Errors.ErrCumulativeExceedsBalance, payer };
  }
  if (maxClaimableAmount <= state.totalClaimed) {
    return { isValid: false, invalidReason: Errors.ErrCumulativeAmountBelowClaimed, payer };
  }

  return {
    isValid: true,
    payer,
    extra: {
      channelId: payload.voucher.channelId,
      balance: state.balance.toString(),
      totalClaimed: state.totalClaimed.toString(),
      withdrawRequestedAt: state.withdrawRequestedAt,
      refundNonce: state.refundNonce.toString(),
    },
  };
}

/**
 * Executes a deposit onchain through the collector for the selected transfer method.
 *
 * @param signer - Facilitator signer used to submit the onchain transaction.
 * @param payment - Full payment envelope (unused; reserved for interface parity).
 * @param payload - The deposit payload.
 * @param requirements - Server payment requirements.
 * @returns A {@link SettleResponse} with the transaction hash and updated channel state.
 */
export async function settleDeposit(
  signer: FacilitatorTronSigner,
  payment: PaymentPayload,
  payload: BatchSettlementDepositPayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  const network = requirements.network;
  const { deposit, voucher } = payload;
  const config = payload.channelConfig;
  const payer = config.payer;

  const verified = await verifyDeposit(signer, payment, payload, requirements);
  if (!verified.isValid) {
    const reason = verified.invalidReason ?? Errors.ErrInvalidPayloadType;
    return {
      success: false,
      errorReason: reason,
      errorMessage: verified.invalidMessage ?? reason,
      transaction: "",
      network,
      payer: verified.payer,
    };
  }

  try {
    const execution = resolveDepositExecution(payload, requirements);

    const tx = await signer.writeContract({
      address: getBatchSettlementAddress(network),
      abi,
      functionName: "deposit",
      args: [
        toContractChannelConfig(config),
        BigInt(deposit.amount),
        normalizeAddressForSigning(execution.collector),
        execution.collectorData,
      ],
    });

    const receipt = await signer.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: Errors.ErrDepositTransactionFailed,
        errorMessage: `transaction reverted (receipt status ${receipt.status})`,
        transaction: tx,
        network,
        payer,
      };
    }

    const expectedMinBalance =
      BigInt(String(verified.extra?.balance ?? "0")) + BigInt(deposit.amount);
    const rpcDeadline = Date.now() + 4_000;
    let postState = await readChannelState(signer, voucher.channelId, network);
    while (postState.balance < expectedMinBalance && Date.now() < rpcDeadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      postState = await readChannelState(signer, voucher.channelId, network);
    }

    return {
      success: true,
      transaction: tx,
      network,
      payer,
      amount: deposit.amount,
      extra: {
        channelState: {
          channelId: voucher.channelId,
          balance: postState.balance.toString(),
          totalClaimed: postState.totalClaimed.toString(),
          withdrawRequestedAt: postState.withdrawRequestedAt,
          refundNonce: postState.refundNonce.toString(),
        },
      },
    };
  } catch (e) {
    return {
      success: false,
      errorReason: Errors.ErrDepositTransactionFailed,
      errorMessage: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
      payer,
    };
  }
}
