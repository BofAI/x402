/**
 * Resource-server observability — BankofAI overlay, NOT from upstream.
 *
 * The mirror of {@link attachFacilitatorLogging} for the resource-server side.
 * Registers logging on the resource server's existing hook surface
 * (`onAfterVerify` / `onVerifyFailure` / `onBeforeSettle` / `onAfterSettle` /
 * `onSettleFailure`) instead of editing the upstream-forked
 * {@link x402ResourceServer} body, so it stays byte-identical to upstream and
 * future pulls stay conflict-free.
 *
 * Why this matters: the resource-server middleware treats a structured
 * facilitator failure (`verify` → `isValid: false`, or `settle` →
 * `success: false`) as a normal `402` outcome and returns it WITHOUT logging —
 * only unexpected exceptions are logged. That hides the real reason from the
 * server operator. These hooks surface it, sharing the exact log format with the
 * facilitator side via {@link paymentLogFormat}.
 *
 * Note the role asymmetry: the facilitator funnels an invalid verify into
 * `onVerifyFailure`, while the resource server surfaces it on `onAfterVerify`
 * with `result.isValid === false`. Both paths emit the same `x402: verify
 * failed` line.
 *
 * @example
 * ```ts
 * import { createResourceServer } from "@bankofai/x402-core";
 *
 * const server = createResourceServer(facilitatorClient); // logging pre-attached
 * server.register("tron:3448148188", scheme);
 * ```
 */
import {
  logVerifyValid,
  logVerifyFailed,
  logSettleStart,
  logSettleResult,
  logSettleThrew,
} from "./paymentLogFormat";
import { x402ResourceServer } from "../server/x402ResourceServer";
import type { FacilitatorClient } from "../http/httpFacilitatorClient";

/**
 * Register structured verify/settle logging on a resource server via its hooks.
 *
 * Idempotency per server is NOT guaranteed — call once per instance. Hooks never
 * abort or recover; they only observe.
 *
 * @internal Package-internal; consumers use {@link createResourceServer}.
 * Exported for unit tests and {@link createResourceServer} only — not public API.
 * @param server - The resource server to instrument.
 * @returns The same server, for chaining.
 */
export function attachResourceServerLogging(server: x402ResourceServer): x402ResourceServer {
  server.onAfterVerify(async ({ requirements, result }) => {
    if (result.isValid) {
      logVerifyValid(
        requirements.scheme,
        requirements.network,
        result.payer ? { payer: result.payer } : undefined,
      );
    } else {
      logVerifyFailed(
        requirements.scheme,
        requirements.network,
        result.invalidReason,
        result.invalidMessage,
      );
    }
  });

  server.onVerifyFailure(async ({ requirements, error }) => {
    logVerifyFailed(requirements.scheme, requirements.network, error.message);
  });

  server.onBeforeSettle(async ({ requirements }) => {
    logSettleStart(requirements.scheme, requirements.network);
  });

  server.onAfterSettle(async ({ requirements, result }) => {
    logSettleResult(requirements.scheme, requirements.network, result);
  });

  server.onSettleFailure(async ({ requirements, error }) => {
    logSettleThrew(requirements.scheme, requirements.network, error.message);
  });

  return server;
}

/**
 * Construct an {@link x402ResourceServer} with structured verify/settle logging
 * pre-attached (via {@link attachResourceServerLogging}).
 *
 * Use this instead of `new x402ResourceServer()` when you want the SDK's default
 * payment-path observability without remembering to wire it. Reach for the bare
 * `new x402ResourceServer()` when you want a pristine, log-free instance.
 *
 * @param facilitatorClients - Facilitator client(s) to delegate verify/settle to.
 * @returns A resource server with logging hooks registered.
 */
export function createResourceServer(
  facilitatorClients?: FacilitatorClient | FacilitatorClient[],
): x402ResourceServer {
  return attachResourceServerLogging(new x402ResourceServer(facilitatorClients));
}
