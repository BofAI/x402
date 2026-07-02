import { SettleResponse, PaymentRequirements } from "@bankofai/x402-core/types";
import { FacilitatorTronSigner } from "../../signer";
import { normalizeAddressForSigning } from "../../utils";
import { BatchSettlementSettlePayload } from "../types";
import { batchSettlementABI } from "../../shared/batch-settlement/abi";
import { getBatchSettlementAddress } from "../../shared/batch-settlement/constants";
import { toBigInt } from "./utils";
import * as Errors from "../errors";

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
 * @returns A {@link SettleResponse} with the transaction hash on success.
 */
export async function executeSettle(
  signer: FacilitatorTronSigner,
  payload: BatchSettlementSettlePayload,
  requirements: PaymentRequirements,
): Promise<SettleResponse> {
  const network = requirements.network;
  const address = getBatchSettlementAddress(network);
  const receiver = normalizeAddressForSigning(payload.receiver);
  const token = normalizeAddressForSigning(payload.token);

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

    const receipt = await signer.waitForTransactionReceipt({ hash: tx });
    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: Errors.ErrSettleTransactionFailed,
        errorMessage: `transaction reverted (receipt status ${receipt.status})`,
        transaction: tx,
        network,
      };
    }

    let amount = "";
    try {
      const [, postSettled] = await readReceiver(signer, address, receiver, token);
      amount = postSettled > preSettled ? (postSettled - preSettled).toString() : "0";
    } catch {
      // Leave amount empty when the post-state read lags.
    }

    return { success: true, transaction: tx, network, amount };
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
