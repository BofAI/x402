import { SettleResponse, PaymentRequirements } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import type {
  TronAuthorizerSigner,
  BatchSettlementEnrichedRefundPayload,
  ChannelState,
} from "../types";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../shared/batch-settlement/constants";
import { computeChannelId } from "../../shared/batch-settlement/utils";
import { encodeFunctionData } from "../../shared/batch-settlement/encoding";
import { signClaimBatch, signRefund } from "../../shared/batch-settlement/authorizerSigner";
import { buildVoucherClaimArgs } from "./claim";
import { readChannelState, toContractChannelConfig } from "./utils";
import * as Errors from "../errors";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];

type RefundSettlementExtra = {
  channelState: {
    channelId: `0x${string}`;
    balance: string;
    totalClaimed: string;
    withdrawRequestedAt: number;
    refundNonce: string;
  };
};

/**
 * Computes the token amount that `refundWithSignature` transfers after any
 * bundled claims are applied.
 *
 * @param payload - Refund payload containing requested refund amount and claims.
 * @param preState - Onchain channel state before the refund transaction.
 * @param channelId - Channel being refunded.
 * @param network - Network identifier used to compute claim channel ids.
 * @returns Refund amount, or `null` when nothing is determinable from claims.
 */
function getRefundableAmount(
  payload: BatchSettlementEnrichedRefundPayload,
  preState: ChannelState,
  channelId: `0x${string}`,
  network: string,
): bigint | null {
  const postClaimTotalClaimed = payload.claims.reduce((max, claim) => {
    const claimChannelId = computeChannelId(claim.voucher.channel, network);
    if (claimChannelId.toLowerCase() !== channelId.toLowerCase()) return max;
    const totalClaimed = BigInt(claim.totalClaimed);
    return totalClaimed > max ? totalClaimed : max;
  }, preState.totalClaimed);

  if (postClaimTotalClaimed > preState.balance) return null;

  const requestedAmount = BigInt(payload.amount);
  if (requestedAmount === 0n) return null;

  const available = preState.balance - postClaimTotalClaimed;
  return requestedAmount > available ? available : requestedAmount;
}

/**
 * Builds facilitator-owned response details for a refund settlement.
 *
 * @param payload - Refund payload containing claims and amount.
 * @param channelId - Canonical channel id for the refund.
 * @param preState - Onchain channel state before this refund.
 * @returns Actual refund amount and extra fields for the settlement response.
 */
function buildRefundExtra(
  payload: BatchSettlementEnrichedRefundPayload,
  channelId: `0x${string}`,
  preState: ChannelState,
): { amount: string; extra: RefundSettlementExtra } {
  const lastClaimTotal =
    payload.claims.length > 0
      ? BigInt(payload.claims[payload.claims.length - 1].totalClaimed)
      : preState.totalClaimed;
  const postClaimTotalClaimed =
    lastClaimTotal > preState.totalClaimed ? lastClaimTotal : preState.totalClaimed;

  const available = preState.balance - postClaimTotalClaimed;
  const requestedAmount = BigInt(payload.amount);
  const actualRefund = requestedAmount > available ? available : requestedAmount;

  return {
    amount: actualRefund.toString(),
    extra: {
      channelState: {
        channelId,
        balance: (preState.balance - actualRefund).toString(),
        totalClaimed: postClaimTotalClaimed.toString(),
        withdrawRequestedAt: 0,
        refundNonce: (preState.refundNonce + 1n).toString(),
      },
    },
  };
}

/**
 * Executes a cooperative refund via `refundWithSignature`, optionally batching a
 * preceding `claimWithSignature` atomically through the contract's `multicall`.
 *
 * @param signer - Facilitator signer used to submit the onchain transaction.
 * @param payload - Refund payload with optional signatures, amount, and nonce.
 * @param requirements - Payment requirements for network identification.
* @param authorizerSigner - Dedicated key for producing TIP-712 signatures.
 *   When omitted, the payload must already carry the required authorizer signatures.
* @returns A {@link SettleResponse} with the transaction hash on success.
*/
export async function executeRefundWithSignature(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementEnrichedRefundPayload,
  requirements: PaymentRequirements,
  authorizerSigner: TronAuthorizerSigner | undefined,
): Promise<SettleResponse> {
  const network = requirements.network;
  const address = getBatchSettlementAddress(network);

  try {
    const channelId = computeChannelId(payload.channelConfig, network);
    const preState = await readChannelState(signer, channelId, network);
    const refundableAmount = getRefundableAmount(payload, preState, channelId, network);

    if (refundableAmount === 0n) {
      return {
        success: false,
        errorReason: Errors.ErrRefundNoBalance,
        errorMessage: "Nothing to refund",
        transaction: "",
        network,
      };
    }

    const hasClientSig = payload.refundAuthorizerSignature !== undefined;
    const authorizerMismatch = authorizerSigner
      ? normalizeAddressForSigning(payload.channelConfig.receiverAuthorizer) !==
        normalizeAddressForSigning(authorizerSigner.address)
      : false;

    if (!hasClientSig && !authorizerSigner) {
      return {
        success: false,
        errorReason: Errors.ErrAuthorizerNotConfigured,
        transaction: "",
        network,
      };
    }

    if (!hasClientSig && authorizerMismatch) {
      return {
        success: false,
        errorReason: Errors.ErrAuthorizerAddressMismatch,
        transaction: "",
        network,
      };
    }

    const refundSig =
      payload.refundAuthorizerSignature ??
      (authorizerSigner
        ? await signRefund(authorizerSigner, channelId, payload.amount, payload.refundNonce, network)
        : undefined);

    const contractConfig = toContractChannelConfig(payload.channelConfig);
    const refundArgs = [
      contractConfig,
      BigInt(payload.amount),
      BigInt(payload.refundNonce),
      refundSig,
    ];

    let tx: string;
    if (payload.claims.length > 0) {
      const claimSig =
        payload.claimAuthorizerSignature ??
        (authorizerSigner
          ? await signClaimBatch(authorizerSigner, payload.claims, network)
          : undefined);
      if (!claimSig) {
        return {
          success: false,
          errorReason: Errors.ErrAuthorizerNotConfigured,
          transaction: "",
          network,
        };
      }

      const claimCalldata = encodeFunctionData(abi, "claimWithSignature", [
        buildVoucherClaimArgs(payload.claims),
        claimSig,
      ]);
      const refundCalldata = encodeFunctionData(abi, "refundWithSignature", refundArgs);

      tx = await signer.writeContract({
        address,
        abi,
        functionName: "multicall",
        args: [[claimCalldata, refundCalldata]],
      });
    } else {
      tx = await signer.writeContract({
        address,
        abi,
        functionName: "refundWithSignature",
        args: refundArgs,
      });
    }

    const receipt = await signer.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: Errors.ErrRefundTransactionFailed,
        errorMessage: `transaction reverted (receipt status ${receipt.status})`,
        transaction: tx,
        network,
      };
    }

    const refundDetails = buildRefundExtra(payload, channelId, preState);
    return {
      success: true,
      transaction: tx,
      network,
      payer: payload.channelConfig.payer,
      amount: refundDetails.amount,
      extra: refundDetails.extra,
    };
  } catch (e) {
    return {
      success: false,
      errorReason: Errors.ErrRefundTransactionFailed,
      errorMessage: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
    };
  }
}
