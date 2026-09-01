import type { Network, SettleResponse } from "@bankofai/x402-core/types";
import type {
  FacilitatorTronSigner,
  TronTransactionFinality,
  TronTransactionReceipt,
} from "../signer";
import { isValidTronTxHash, truncateErrorMessage } from "../utils";

/** Non-terminal result for a transaction whose onchain effect is not known yet. */
export const SETTLEMENT_PENDING = "settlement_pending";

/** Optional behavior for {@link waitAndReturnSettleResponse}. */
export interface WaitForSettleReceiptOptions {
  /** Scheme/action-specific reason used for invalid txids and reverted receipts. */
  failedStatusReason?: string;
  /** Settled amount attached to the default success response. */
  amount?: string;
  /** Required receipt source. Reconciliation uses `solidified`; settle defaults to packed. */
  finality?: TronTransactionFinality;
  /** Durable metadata to attach to every post-broadcast response. */
  responseExtra?: Record<string, unknown>;
  /** Performs an explicit effect check after a successful receipt. */
  validateReceipt?: (receipt: TronTransactionReceipt) => SettleResponse | undefined;
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
  const {
    failedStatusReason = "invalid_transaction_state",
    amount,
    finality,
    responseExtra,
    validateReceipt,
    onSuccess,
  } = options;

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
    receipt = await signer.waitForTransactionReceipt({
      hash: tx,
      ...(finality ? { finality } : {}),
    });
  } catch (error) {
    return settlementPendingResponse(tx, network, payer, error, responseExtra);
  }

  try {
    if (receipt.status === "pending") {
      return settlementPendingResponse(
        tx,
        network,
        payer,
        new Error("transaction receipt remained pending within the confirmation budget"),
        responseExtra,
      );
    }

    if (finality && receipt.finality !== finality) {
      return settlementPendingResponse(
        tx,
        network,
        payer,
        new Error(`transaction receipt is ${receipt.finality ?? "unknown"}, expected ${finality}`),
        responseExtra,
      );
    }

    if (receipt.status !== "success") {
      return withResponseExtra(
        {
          success: false,
          errorReason: failedStatusReason,
          transaction: tx,
          network,
          payer,
        },
        responseExtra,
      );
    }

    const validationFailure = validateReceipt?.(receipt);
    if (validationFailure) return withResponseExtra(validationFailure, responseExtra);

    if (onSuccess) return withResponseExtra(await onSuccess(receipt), responseExtra);

    return withResponseExtra(
      {
        success: true,
        transaction: tx,
        network,
        payer,
        ...(amount !== undefined ? { amount } : {}),
      },
      responseExtra,
    );
  } catch (error) {
    return settlementPendingResponse(tx, network, payer, error, responseExtra);
  }
}

/**
 * Builds a non-terminal response while preserving the broadcast transaction id.
 *
 * @param tx - Transaction id returned by the broadcast operation.
 * @param network - Network on which the transaction was broadcast.
 * @param payer - Payer address, when known.
 * @param error - Error that made the receipt result indeterminate.
 * @param responseExtra - Durable metadata to preserve in the pending response.
 * @returns A pending settlement response carrying the original transaction id.
 */
function settlementPendingResponse(
  tx: string,
  network: Network,
  payer: string | undefined,
  error: unknown,
  responseExtra?: Record<string, unknown>,
): SettleResponse {
  return withResponseExtra(
    {
      success: false,
      errorReason: SETTLEMENT_PENDING,
      errorMessage: truncateErrorMessage(error instanceof Error ? error.message : String(error)),
      transaction: tx,
      network,
      payer,
    },
    responseExtra,
  );
}

/**
 * Merge durable post-broadcast metadata without discarding scheme response fields.
 *
 * @param response - Scheme-generated settlement response.
 * @param responseExtra - Metadata generated before broadcast.
 * @returns Response containing both existing and durable metadata.
 */
function withResponseExtra(
  response: SettleResponse,
  responseExtra: Record<string, unknown> | undefined,
): SettleResponse {
  if (!responseExtra) return response;
  return { ...response, extra: { ...response.extra, ...responseExtra } };
}
