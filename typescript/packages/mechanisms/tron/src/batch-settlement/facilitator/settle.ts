import type { TronPendingSettlementContext } from "../../shared/pendingSettlement";
import { SettleResponse, PaymentRequirements } from "@x402/core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import { BatchSettlementSettlePayload } from "../types";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../shared/batch-settlement/constants";
import { toBigInt } from "./utils";
import * as Errors from "../errors";
import { waitAndReturnSettleResponse } from "../../shared/settleReceipt";

const abi = batchSettlementABI as unknown as readonly Record<string, unknown>[];

/**
 * Reads `receivers(receiver, token)` returning `[totalClaimed, totalSettled]`.
 *
 * @param signer - Facilitator signer for onchain reads.
 * @param address - Batch-settlement contract address.
 * @param receiver - Receiver address (hex).
 * @param token - Token address (hex).
 * @returns Tuple of `[totalClaimed, totalSettled]`.
 */
async function readReceiver(
  signer: FacilitatorTronSigner,
  address: string,
  receiver: string,
  token: string,
): Promise<[bigint, bigint]> {
  const result = await signer.readContract({
    address,
    abi,
    functionName: "receivers",
    args: [receiver, token],
  });
  if (Array.isArray(result)) {
    return [toBigInt(result[0]), toBigInt(result[1])];
  }
  const obj = result as Record<string, unknown>;
  return [toBigInt(obj.totalClaimed ?? obj["0"]), toBigInt(obj.totalSettled ?? obj["1"])];
}

/**
 * Transfers claimed funds from the contract to the receiver.
 *
 * Should be called after one or more `claim()` transactions have updated the
 * receiver's `totalClaimed` accounting onchain. The settled amount is derived
 * from the `totalSettled` delta (no event parsing).
 *
 * @param signer - Facilitator signer used to submit the settlement transaction.
 * @param payload - Settle payload containing the receiver and token addresses.
 * @param requirements - Payment requirements for network identification.
 * @param pending - Original-transaction tracking for this attempt.
 * @returns A {@link SettleResponse} with the transaction hash on success.
 */
export async function executeSettle(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementSettlePayload,
  requirements: PaymentRequirements,
  pending?: TronPendingSettlementContext,
): Promise<SettleResponse> {
  const network = requirements.network;
  const address = getBatchSettlementAddress(network);
  const receiver = normalizeAddressForSigning(payload.receiver);
  const token = normalizeAddressForSigning(payload.token);

  if (pending?.record)
    return waitForSettle(
      signer,
      pending.record.transaction,
      network,
      address,
      receiver,
      token,
      BigInt(pending.record.data!.preSettled),
      pending,
    );

  let preSettled: bigint;
  try {
    const [totalClaimed, totalSettled] = await readReceiver(signer, address, receiver, token);
    if (totalClaimed <= totalSettled) {
      return {
        success: false,
        errorReason: Errors.ErrNothingToSettle,
        errorMessage: "nothing to settle for receiver and token",
        transaction: "",
        network,
      };
    }
    preSettled = totalSettled;
  } catch (e) {
    return {
      success: false,
      errorReason: Errors.ErrRpcReadFailed,
      errorMessage: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
    };
  }

  try {
    const tx = await signer.writeContract({
      address,
      abi,
      functionName: "settle",
      args: [receiver, token],
    });

    return waitForSettle(signer, tx, network, address, receiver, token, preSettled, pending);
  } catch (e) {
    return {
      success: false,
      errorReason: Errors.ErrSettleTransactionFailed,
      errorMessage: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
    };
  }
}

/**
 * Recover the settled delta against the original pre-broadcast snapshot.
 *
 * @param signer - TRON signer used to read confirmed chain state.
 * @param tx - Original broadcast transaction ID.
 * @param network - Network on which the transaction was broadcast.
 * @param address - Batch settlement contract address.
 * @param receiver - Receiver whose settlement balance is queried.
 * @param token - Token being settled.
 * @param preSettled - Total settled before the original transaction.
 * @param pending - Original-transaction tracking for this attempt.
 * @returns Settlement result preserving the original transaction identity.
 */
async function waitForSettle(
  signer: FacilitatorTronSigner,
  tx: string,
  network: PaymentRequirements["network"],
  address: string,
  receiver: string,
  token: string,
  preSettled: bigint,
  pending?: TronPendingSettlementContext,
): Promise<SettleResponse> {
  return waitAndReturnSettleResponse(signer, tx, network, undefined, {
    pending,
    pendingData: { preSettled: preSettled.toString() },
    failedStatusReason: Errors.ErrSettleTransactionFailed,
    onSuccess: async () => {
      const [totalClaimed, postSettled] = await readReceiver(signer, address, receiver, token);
      const amount = postSettled > preSettled ? (postSettled - preSettled).toString() : "0";
      return {
        success: true,
        transaction: tx,
        network,
        amount,
        extra: { pendingSettle: totalClaimed > postSettled },
      };
    },
  });
}
