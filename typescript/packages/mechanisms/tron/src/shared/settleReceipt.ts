import type { Network, SettleResponse } from "@bankofai/x402-core/types";
import type { FacilitatorTronSigner, TronTransactionReceipt } from "../signer";
import { isValidTronTxHash, truncateErrorMessage } from "../utils";

/** Non-terminal result for a transaction whose onchain effect is not known yet. */
export const SETTLEMENT_PENDING = "settlement_pending";

/** Optional behavior for {@link waitAndReturnSettleResponse}. */
export interface WaitForSettleReceiptOptions {
  /** Scheme/action-specific reason used for invalid txids and reverted receipts. */
  failedStatusReason?: string;
  /** Settled amount attached to the default success response. */
  amount?: string;
  /** Builds a custom success response, including any post-receipt state reads. */
  onSuccess?: (receipt: TronTransactionReceipt) => SettleResponse | Promise<SettleResponse>;
}

/**
 * Converts the result of an already-broadcast TRON transaction into a SettleResponse.
 *
 * Invalid txids and explicit reverts are terminal. A pending receipt, an RPC error,
 * or an unexpected receipt-processing error is non-terminal and preserves the txid
 * for reconciliation. This function never broadcasts or retries a transaction.
 *
 * @param signer - Signer exposing read-only receipt waiting.
 * @param tx - Transaction id returned by the broadcast operation.
 * @param network - Network on which the transaction was broadcast.
 * @param payer - Payer address, when known.
 * @param options - Scheme-specific terminal reason and optional success processing.
 * @returns Settlement response with the correct terminal or pending semantics.
 */
export async function waitAndReturnSettleResponse(
  signer: Pick<FacilitatorTronSigner, "waitForTransactionReceipt">,
  tx: string,
  network: Network,
  payer: string | undefined,
  options: WaitForSettleReceiptOptions = {},
): Promise<SettleResponse> {
  const { failedStatusReason = "invalid_transaction_state", amount, onSuccess } = options;

  if (!isValidTronTxHash(tx)) {
    return {
      success: false,
      errorReason: failedStatusReason,
      errorMessage: `signer returned an invalid transaction hash: ${String(tx)}`,
      transaction: "",
      network,
      payer,
    };
  }

  let receipt: TronTransactionReceipt;
  try {
    receipt = await signer.waitForTransactionReceipt({ hash: tx });
  } catch (error) {
    return settlementPendingResponse(tx, network, payer, error);
  }

  try {
    if (receipt.status === "pending") {
      return settlementPendingResponse(
        tx,
        network,
        payer,
        new Error("transaction receipt remained pending within the confirmation budget"),
      );
    }

    if (receipt.status !== "success") {
      return {
        success: false,
        errorReason: failedStatusReason,
        transaction: tx,
        network,
        payer,
      };
    }

    if (onSuccess) return await onSuccess(receipt);

    return {
      success: true,
      transaction: tx,
      network,
      payer,
      ...(amount !== undefined ? { amount } : {}),
    };
  } catch (error) {
    return settlementPendingResponse(tx, network, payer, error);
  }
}

/**
 * Builds a non-terminal response while preserving the broadcast transaction id.
 *
 * @param tx - Transaction id returned by the broadcast operation.
 * @param network - Network on which the transaction was broadcast.
 * @param payer - Payer address, when known.
 * @param error - Error that made the receipt result indeterminate.
 * @returns A pending settlement response carrying the original transaction id.
 */
function settlementPendingResponse(
  tx: string,
  network: Network,
  payer: string | undefined,
  error: unknown,
): SettleResponse {
  return {
    success: false,
    errorReason: SETTLEMENT_PENDING,
    errorMessage: truncateErrorMessage(error instanceof Error ? error.message : String(error)),
    transaction: tx,
    network,
    payer,
  };
}
