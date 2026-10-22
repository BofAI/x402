/** RPC capability required for packed-receipt polling. */
import type { TronTransactionReceipt } from "../signer";
import { log } from "../logger";
import { isValidTronTxHash } from "../utils";
export interface TronReceiptClient {
  fullNode: { request(path: string, payload: object, method: "post"): Promise<unknown> };
}

export const DEFAULT_CONFIRMATION_TIMEOUT_MS = 90_000;
const MAX_CONFIRMATION_TIMEOUT_MS = 2_147_483_647;

type TronTxInfo = {
  blockNumber?: number;
  receipt?: { result?: string };
};

const TERMINAL_RECEIPT_FAILURES = new Set([
  "REVERT",
  "BAD_JUMP_DESTINATION",
  "OUT_OF_MEMORY",
  "PRECOMPILED_CONTRACT",
  "STACK_TOO_SMALL",
  "STACK_TOO_LARGE",
  "ILLEGAL_OPERATION",
  "STACK_OVERFLOW",
  "OUT_OF_ENERGY",
  "OUT_OF_TIME",
  "JVM_STACK_OVER_FLOW",
  "UNKNOWN",
  "TRANSFER_FAILED",
  "INVALID_CODE",
]);

/**
 * Resolve and validate a caller-supplied packed-receipt timeout.
 *
 * @param value - Configured timeout, or undefined to use the default.
 * @returns The validated confirmation timeout in milliseconds.
 */
export function resolveConfirmationTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_CONFIRMATION_TIMEOUT_MS
  ) {
    throw new Error(
      `confirmationTimeoutMs must be a positive integer no greater than ${MAX_CONFIRMATION_TIMEOUT_MS}, got ${timeoutMs}`,
    );
  }
  return timeoutMs;
}

/**
 * Await a single RPC request without allowing it to exceed the remaining budget.
 *
 * @param request - Receipt RPC request to await.
 * @param timeoutMs - Remaining confirmation budget in milliseconds.
 * @returns The RPC response when it completes within the remaining budget.
 */
async function requestWithin<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TRON receipt RPC timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Poll TRON for a transaction's confirmed result via the fullNode
 * `gettransactioninfobyid` endpoint.
 *
 * Unlike `getTransaction` (which returns a preconfirm `contractRet` that can
 * transiently read REVERT on mainnet), this endpoint only populates
 * `blockNumber` once the tx is packed into a block (~3-6s). The
 * `receipt.result` field then carries the execution status for that provisional
 * FullNode head. This mirrors tronpy's
 * `get_transaction_info`, which uses the same fullNode endpoint.
 *
 * (tronweb's own `trx.getTransactionInfo` reaches the solidityNode variant
 * `walletsolidity/gettransactioninfobyid`, which only returns after the block
 * solidifies (~19 confirmations / ~60s) — too slow. Calling the fullNode
 * endpoint directly avoids that delay while staying accurate.)
 *
 * @param tronWeb - The TronWeb instance used to read the transaction.
 * @param hash - The transaction id to wait for.
 * @param timeoutMs - Total confirmation budget in milliseconds.
 * @returns `success` / `reverted` once packed, or `pending` when still indeterminate.
 */
export async function pollTransactionPacked(
  tronWeb: TronReceiptClient,
  hash: string,
  timeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS,
): Promise<TronTransactionReceipt> {
  if (!isValidTronTxHash(hash)) {
    throw new Error(`invalid TRON transaction id: ${hash}`);
  }
  const rpcHash = hash.replace(/^0x/i, "").toLowerCase();
  const delayMs = 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    let info: TronTxInfo | null = null;
    try {
      info = await requestWithin(
        tronWeb.fullNode.request(
          "wallet/gettransactioninfobyid",
          { value: rpcHash },
          "post",
        ) as Promise<TronTxInfo | null>,
        Math.max(1, deadline - Date.now()),
      );
    } catch {
      // Not yet confirmed / transient node or rate-limit error — keep polling.
    }
    if (info?.blockNumber != null) {
      const result = info.receipt?.result;
      if (result === "SUCCESS") {
        log.info("x402 tron: tx packed", {
          hash,
          status: "success",
          contractRet: result,
        });
        return { status: "success" };
      }
      if (result && TERMINAL_RECEIPT_FAILURES.has(result)) {
        log.warn("x402 tron: tx packed", {
          hash,
          status: "reverted",
          contractRet: result,
        });
        return { status: "reverted" };
      }
      log.info("x402 tron: tx receipt incomplete", {
        hash,
        contractRet: result,
      });
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(delayMs, remainingMs)));
  }

  log.warn("x402 tron: tx confirm timeout (pending)", { hash, timeoutMs });
  return { status: "pending" };
}
