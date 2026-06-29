/**
 * Opt-in payment-lifecycle logging for the resource server.
 *
 * Why this exists
 * ---------------
 * The resource-server middleware treats a structured facilitator failure
 * (`verify` → `isValid: false`, or `settle` → `success: false`) as a normal
 * `402` outcome and returns it WITHOUT logging — only unexpected exceptions get
 * logged. So a rejected payment looks silent on the server (the client just sees
 * `402 {}`), hiding the real reason (`invalidReason` / `errorReason`).
 *
 * This mirrors the SDK's own `attachFacilitatorLogging`: instead of wrapping the
 * facilitator client, it registers observers on the resource server's existing
 * hook surface. Hooks only observe — they never abort or alter the result.
 *
 *   onAfterVerify    — verify returned (valid OR invalid); carries result
 *   onVerifyFailure  — verify threw (HTTP/WAF/network error)
 *   onBeforeSettle   — settlement starting
 *   onAfterSettle    — settle returned (success OR failure); carries result
 *   onSettleFailure  — settle threw
 */
import type { x402ResourceServer } from "@bankofai/x402-core/server";

/** Register verify/settle lifecycle logging on the resource server. */
export function attachPaymentLogging(server: x402ResourceServer): void {
  server.onAfterVerify(async ({ requirements, result }) => {
    const at = `${requirements.scheme}@${requirements.network} ${requirements.asset}`;
    if (result.isValid) {
      console.log(`✅ verify ok   ${at}`, { payer: result.payer });
    } else {
      console.log(`❌ verify invalid ${at}`, {
        invalidReason: result.invalidReason,
        invalidMessage: result.invalidMessage,
      });
    }
  });

  server.onVerifyFailure(async ({ requirements, error }) => {
    console.error(
      `💥 verify threw ${requirements.scheme}@${requirements.network}`,
      error.message,
    );
  });

  server.onBeforeSettle(async ({ requirements }) => {
    console.log(`💸 settle start ${requirements.scheme}@${requirements.network} ${requirements.asset}`);
  });

  server.onAfterSettle(async ({ requirements, result }) => {
    const at = `${requirements.scheme}@${requirements.network}`;
    if (result.success) {
      console.log(`✅ settle ok   ${at}`, {
        transaction: result.transaction,
        payer: result.payer,
        amount: result.amount,
      });
    } else {
      console.log(`❌ settle failed ${at}`, {
        errorReason: result.errorReason,
        errorMessage: result.errorMessage,
        transaction: result.transaction,
      });
    }
  });

  server.onSettleFailure(async ({ requirements, error }) => {
    console.error(
      `💥 settle threw ${requirements.scheme}@${requirements.network}`,
      error.message,
    );
  });
}
