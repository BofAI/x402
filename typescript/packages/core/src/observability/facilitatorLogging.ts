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
 * import { createFacilitator } from "@bankofai/x402-core";
 *
 * const facilitator = createFacilitator(); // logging pre-attached
 * facilitator.register("tron:3448148188", scheme);
 * ```
 */
import {
  logVerifyValid,
  logVerifyFailed,
  logSettleStart,
  logSettleResult,
  logSettleThrew,
} from "./paymentLogFormat";
import { x402Facilitator } from "../facilitator/x402Facilitator";

/**
 * Register structured verify/settle logging on a facilitator via its hooks.
 *
 * Idempotent per facilitator is NOT guaranteed — call once per instance.
 * Hooks never abort or recover; they only observe.
 *
 * @internal Package-internal; consumers use {@link createFacilitator}. Exported
 * for unit tests and {@link createFacilitator} only — not part of the public API.
 * @param facilitator - The facilitator to instrument.
 * @returns The same facilitator, for chaining.
 */
export function attachFacilitatorLogging(facilitator: x402Facilitator): x402Facilitator {
  facilitator.onAfterVerify(async ({ requirements }) => {
    logVerifyValid(requirements.scheme, requirements.network);
  });

  facilitator.onVerifyFailure(async ({ requirements, error }) => {
    logVerifyFailed(requirements.scheme, requirements.network, error.message);
  });

  facilitator.onBeforeSettle(async ({ requirements }) => {
    logSettleStart(requirements.scheme, requirements.network);
  });

  facilitator.onAfterSettle(async ({ requirements, result }) => {
    logSettleResult(requirements.scheme, requirements.network, result);
  });

  facilitator.onSettleFailure(async ({ requirements, error }) => {
    logSettleThrew(requirements.scheme, requirements.network, error.message);
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
