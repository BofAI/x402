/**
 * Shared verify/settle log formatting — BankofAI overlay, NOT from upstream.
 *
 * Single source of truth for the message strings, log levels, and field shapes
 * emitted on the payment path, so both {@link attachFacilitatorLogging} (the
 * settlement authority) and {@link attachResourceServerLogging} (the resource
 * server delegating to a facilitator) produce identical, greppable logs through
 * the injectable global {@link log}.
 *
 * The two roles differ in WHICH hook carries a given outcome — the facilitator
 * funnels an invalid verify into `onVerifyFailure`, while the resource server
 * surfaces it on `onAfterVerify` with `result.isValid === false` — but the log
 * line they emit is the same. Each role's `attach*` maps its hooks onto these.
 */
import { log } from "./logger";

/**
 * Log a successful verify.
 *
 * @param scheme - Payment scheme (e.g. `exact`).
 * @param network - CAIP-2 network id.
 * @param extra - Optional extra fields to include (e.g. `{ payer }`).
 */
export function logVerifyValid(
  scheme: string,
  network: string,
  extra?: Record<string, unknown>,
): void {
  log.info("x402: verify result", { scheme, network, isValid: true, ...extra });
}

/**
 * Log a failed verify — covers both a structured `isValid: false` and a thrown
 * error; `reason` is the cause in either case.
 *
 * @param scheme - Payment scheme.
 * @param network - CAIP-2 network id.
 * @param reason - Failure reason (invalidReason or error message).
 * @param message - Optional human-readable detail.
 */
export function logVerifyFailed(
  scheme: string,
  network: string,
  reason: string | undefined,
  message?: string,
): void {
  log.warn("x402: verify failed", {
    scheme,
    network,
    reason,
    ...(message ? { message } : {}),
  });
}

/**
 * Log the start of settlement.
 *
 * @param scheme - Payment scheme.
 * @param network - CAIP-2 network id.
 */
export function logSettleStart(scheme: string, network: string): void {
  log.info("x402: settle start", { scheme, network });
}

/** Settle outcome the formatter reads — a structural subset of `SettleResponse`. */
export interface SettleOutcome {
  success: boolean;
  transaction?: string;
  errorReason?: string;
}

/**
 * Log a settle result — success or a structured failure (`success: false`).
 *
 * @param scheme - Payment scheme.
 * @param network - CAIP-2 network id.
 * @param result - The settle outcome.
 */
export function logSettleResult(scheme: string, network: string, result: SettleOutcome): void {
  log[result.success ? "info" : "warn"]("x402: settle result", {
    scheme,
    network,
    success: result.success,
    ...(result.transaction ? { transaction: result.transaction } : {}),
    ...(result.success ? {} : { errorReason: result.errorReason }),
  });
}

/**
 * Log a thrown settle error.
 *
 * @param scheme - Payment scheme.
 * @param network - CAIP-2 network id.
 * @param error - The error message.
 */
export function logSettleThrew(scheme: string, network: string, error: string): void {
  log.error("x402: settle threw", { scheme, network, error });
}
