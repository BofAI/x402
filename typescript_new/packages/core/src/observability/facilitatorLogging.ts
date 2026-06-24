/**
 * Facilitator observability — BankofAI overlay, NOT from upstream.
 *
 * Registers logging on the facilitator's existing hook surface
 * (`onAfterVerify` / `onVerifyFailure` / `onBeforeSettle` / `onAfterSettle` /
 * `onSettleFailure`) instead of editing the upstream-forked
 * {@link x402Facilitator} body. This keeps `facilitator/x402Facilitator.ts`
 * byte-identical to upstream so future upstream pulls stay conflict-free, while
 * still emitting structured logs for the verify/settle payment nodes through the
 * injectable global {@link log}.
 *
 * @example
 * ```ts
 * import { x402Facilitator } from "@bankofai/x402-core/facilitator";
 * import { attachFacilitatorLogging } from "@bankofai/x402-core";
 *
 * const facilitator = attachFacilitatorLogging(new x402Facilitator());
 * facilitator.register("tron:nile", scheme);
 * ```
 */
import { log } from "./logger";
import { x402Facilitator } from "../facilitator/x402Facilitator";

/**
 * Register structured verify/settle logging on a facilitator via its hooks.
 *
 * Idempotent per facilitator is NOT guaranteed — call once per instance.
 * Hooks never abort or recover; they only observe.
 *
 * @param facilitator - The facilitator to instrument.
 * @returns The same facilitator, for chaining.
 */
export function attachFacilitatorLogging(facilitator: x402Facilitator): x402Facilitator {
  facilitator.onAfterVerify(async ({ requirements }) => {
    log.info("x402: verify result", {
      scheme: requirements.scheme,
      network: requirements.network,
      isValid: true,
    });
  });

  facilitator.onVerifyFailure(async ({ requirements, error }) => {
    log.warn("x402: verify failed", {
      scheme: requirements.scheme,
      network: requirements.network,
      reason: error.message,
    });
  });

  facilitator.onBeforeSettle(async ({ requirements }) => {
    log.info("x402: settle start", {
      scheme: requirements.scheme,
      network: requirements.network,
    });
  });

  facilitator.onAfterSettle(async ({ requirements, result }) => {
    log[result.success ? "info" : "warn"]("x402: settle result", {
      scheme: requirements.scheme,
      network: requirements.network,
      success: result.success,
      ...(result.transaction ? { transaction: result.transaction } : {}),
      ...(result.success ? {} : { errorReason: result.errorReason }),
    });
  });

  facilitator.onSettleFailure(async ({ requirements, error }) => {
    log.error("x402: settle threw", {
      scheme: requirements.scheme,
      network: requirements.network,
      error: error.message,
    });
  });

  return facilitator;
}

/**
 * Construct an {@link x402Facilitator} with structured verify/settle logging
 * pre-attached (via {@link attachFacilitatorLogging}).
 *
 * Use this instead of `new x402Facilitator()` when you want the SDK's default
 * payment-path observability without remembering to wire it. Reach for the bare
 * `new x402Facilitator()` when you want a pristine, log-free instance.
 *
 * @returns A facilitator with logging hooks registered.
 */
export function createFacilitator(): x402Facilitator {
  return attachFacilitatorLogging(new x402Facilitator());
}
