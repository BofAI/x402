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
  /** Required receipt source. Synchronous settlement defaults to packed. */
  finality?: TronTransactionFinality;
  /** Durable metadata to attach to every post-broadcast response. */
  responseExtra?: Record<string, unknown>;
  /** Performs an explicit effect check after a successful receipt. */
  validateReceipt?: (receipt: TronTransactionReceipt) => SettleResponse | undefined;
  /** Builds a custom success response, including any post-receipt state reads. */
  onSuccess?: (receipt: TronTransactionReceipt) => SettleResponse | Promise<SettleResponse>;
}

/** Options for one bounded receipt read without polling. */
export interface ReadForSettleReceiptOptions extends WaitForSettleReceiptOptions {
  /** Maximum duration of the single receipt/body lookup. */
  timeoutMs: number;
  /** Caller cancellation used by background workers during graceful shutdown. */
  signal?: AbortSignal;
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
  const invalidResponse = invalidTransactionResponse(tx, network, payer, options);
  if (invalidResponse) return invalidResponse;

  let receipt: TronTransactionReceipt;
  try {
    receipt = await signer.waitForTransactionReceipt({
      hash: tx,
      ...(options.finality ? { finality: options.finality } : {}),
    });
  } catch (error) {
    return settlementPendingResponse(tx, network, payer, error, options.responseExtra);
  }

  return settleResponseFromReceipt(receipt, tx, network, payer, options);
}

/**
 * Read and classify an already-broadcast transaction exactly once.
 *
 * Unlike {@link waitAndReturnSettleResponse}, this function never polls. The
 * caller owns retry, backoff, concurrency, and scheduling.
 *
 * @param signer - Signer exposing an optional one-shot receipt reader.
 * @param tx - Transaction id returned by the broadcast operation.
 * @param network - Network on which the transaction was broadcast.
 * @param payer - Payer address, when known.
 * @param options - Single-query bound plus receipt-classification behavior.
 * @returns Settlement response from the current solidified view.
 */
export async function readAndReturnSettleResponse(
  signer: Pick<FacilitatorTronSigner, "getTransactionReceipt">,
  tx: string,
  network: Network,
  payer: string | undefined,
  options: ReadForSettleReceiptOptions,
): Promise<SettleResponse> {
  const invalidResponse = invalidTransactionResponse(tx, network, payer, options);
  if (invalidResponse) return invalidResponse;
  if (!signer.getTransactionReceipt) {
    throw new Error("TRON reconciliation requires signer.getTransactionReceipt");
  }
  if (options.signal?.aborted) {
    throw options.signal.reason instanceof Error
      ? options.signal.reason
      : new Error("TRON reconciliation was aborted");
  }

  let receipt: TronTransactionReceipt;
  try {
    receipt = await receiptQueryWithin(
      signer.getTransactionReceipt({
        hash: tx,
        ...(options.finality ? { finality: options.finality } : {}),
        timeoutMs: options.timeoutMs,
        ...(options.signal ? { signal: options.signal } : {}),
      }),
      options.timeoutMs,
      options.signal,
    );
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return settlementPendingResponse(tx, network, payer, error, options.responseExtra);
  }

  return settleResponseFromReceipt(receipt, tx, network, payer, options);
}

/**
 * Enforce the SDK-level bound even when a custom signer ignores query options.
 *
 * @param query - In-flight one-shot signer query.
 * @param timeoutMs - Maximum duration for this attempt.
 * @param signal - Optional worker cancellation signal.
 * @returns The query result within the caller's bound.
 */
async function receiptQueryWithin<T>(
  query: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("TRON reconciliation was aborted");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("TRON reconciliation receipt query timed out")),
          timeoutMs,
        );
      }),
      ...(signal
        ? [
            new Promise<never>((_, reject) => {
              abortListener = () =>
                reject(
                  signal.reason instanceof Error
                    ? signal.reason
                    : new Error("TRON reconciliation was aborted"),
                );
              signal.addEventListener("abort", abortListener, { once: true });
            }),
          ]
        : []),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }
}

/**
 * Map one observed receipt into terminal or pending protocol semantics.
 *
 * @param receipt - Receipt returned by a wait or one-shot read.
 * @param tx - Original transaction id.
 * @param network - Settlement network.
 * @param payer - Settlement payer, when known.
 * @param options - Scheme-specific classification behavior.
 * @returns Settlement response derived from the receipt.
 */
async function settleResponseFromReceipt(
  receipt: TronTransactionReceipt,
  tx: string,
  network: Network,
  payer: string | undefined,
  options: WaitForSettleReceiptOptions,
): Promise<SettleResponse> {
  const {
    failedStatusReason = "invalid_transaction_state",
    amount,
    finality,
    responseExtra,
    validateReceipt,
    onSuccess,
  } = options;
  try {
    if (receipt.status === "pending") {
      return settlementPendingResponse(
        tx,
        network,
        payer,
        new Error("transaction receipt is not available at the requested finality"),
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
 * Reject an invalid signer-supplied transaction id before any receipt query.
 *
 * @param tx - Candidate transaction id.
 * @param network - Settlement network.
 * @param payer - Settlement payer, when known.
 * @param options - Scheme-specific failure reason.
 * @returns Terminal invalid-hash response, or undefined for a valid id.
 */
function invalidTransactionResponse(
  tx: string,
  network: Network,
  payer: string | undefined,
  options: WaitForSettleReceiptOptions,
): SettleResponse | undefined {
  if (isValidTronTxHash(tx)) return undefined;
  return {
    success: false,
    errorReason: options.failedStatusReason ?? "invalid_transaction_state",
    errorMessage: `signer returned an invalid transaction hash: ${String(tx)}`,
    transaction: "",
    network,
    payer,
  };
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
