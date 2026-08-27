import type {
  FacilitatorContext,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from "@bankofai/x402-core/types";
import {
  extractTrc20ApprovalResourceSponsoringInfo,
  resolveTrc20ApprovalResourceSponsoringRuntime,
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  type Trc20ApprovalResourceSponsoringFacilitatorExtension,
  type Trc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringRuntime,
  type Trc20SponsorshipRevalidationResult,
} from "../extensions";
import * as errors from "./errors";
import {
  buildTrc20ApprovalSponsoringRequest,
  validateTrc20ApprovalForPayment,
} from "./trc20approval";

interface SponsorshipBinding {
  info: Trc20ApprovalResourceSponsoringInfo;
  runtime: Trc20ApprovalResourceSponsoringRuntime;
  request: ReturnType<typeof buildTrc20ApprovalSponsoringRequest>;
}

type SponsorshipResolution =
  | { state: "absent" }
  | { state: "invalid"; reason: string; message?: string }
  | { state: "ready"; binding: SponsorshipBinding };

/**
 * Returns whether the payload explicitly carries the Extension key.
 *
 * @param payload - Payment payload to inspect.
 * @returns Whether the key is present.
 */
function hasExtension(payload: PaymentPayload): boolean {
  return Object.prototype.hasOwnProperty.call(
    payload.extensions ?? {},
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
}

/**
 * Resolves and revalidates the immutable Approval-to-Payment binding.
 *
 * @param payload - Client payment payload.
 * @param requirements - Trusted payment requirements.
 * @param payer - Authenticated Permit2 payer.
 * @param context - Registered Facilitator extensions.
 * @param requiredAllowance - Permit2 allowance required by the selected operation.
 * @returns Absent, invalid, or ready sponsorship state.
 */
function resolveSponsorship(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  payer: string,
  context?: FacilitatorContext,
  requiredAllowance = requirements.amount,
): SponsorshipResolution {
  const info = extractTrc20ApprovalResourceSponsoringInfo(payload);
  if (!info) {
    return hasExtension(payload)
      ? { state: "invalid", reason: errors.APPROVAL_EXTENSION_INVALID }
      : { state: "absent" };
  }
  const extension = context?.getExtension<Trc20ApprovalResourceSponsoringFacilitatorExtension>(
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
  const runtime = resolveTrc20ApprovalResourceSponsoringRuntime(extension, requirements.network);
  if (!runtime) return { state: "invalid", reason: errors.SPONSOR_RUNTIME_UNAVAILABLE };
  const validation = validateTrc20ApprovalForPayment(info, payer, requirements);
  if (!validation.isValid) {
    return {
      state: "invalid",
      reason: validation.invalidReason,
      message: validation.invalidMessage,
    };
  }
  return {
    state: "ready",
    binding: {
      info,
      runtime,
      request: buildTrc20ApprovalSponsoringRequest(
        info,
        validation.approval,
        payload,
        requirements,
        requiredAllowance,
      ),
    },
  };
}

/**
 * Runs the read-only sponsorship policy and chain preflight.
 *
 * @param payload - Client payment payload.
 * @param requirements - Trusted payment requirements.
 * @param payer - Authenticated Permit2 payer.
 * @param context - Registered Facilitator extensions.
 * @param requiredAllowance - Permit2 allowance required by the selected operation.
 * @returns Null when absent, otherwise the verification response.
 */
export async function verifyTrc20Sponsorship(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  payer: string,
  context?: FacilitatorContext,
  requiredAllowance?: string,
): Promise<VerifyResponse | null> {
  const resolution = resolveSponsorship(payload, requirements, payer, context, requiredAllowance);
  if (resolution.state === "absent") return null;
  if (resolution.state === "invalid") {
    return {
      isValid: false,
      invalidReason: resolution.reason,
      invalidMessage: resolution.message,
      payer,
    };
  }
  try {
    const result = await resolution.binding.runtime.verify(resolution.binding.request);
    return result.isValid
      ? { isValid: true, invalidReason: undefined, payer }
      : {
          isValid: false,
          invalidReason: result.invalidReason ?? errors.SPONSOR_POLICY_DENIED,
          invalidMessage: result.invalidMessage,
          payer,
        };
  } catch {
    return {
      isValid: false,
      invalidReason: errors.SPONSOR_POLICY_DENIED,
      invalidMessage: "Sponsorship preflight failed",
      payer,
    };
  }
}

/**
 * Executes the durable resource sponsorship lifecycle before payment settlement.
 *
 * @param payload - Client payment payload.
 * @param requirements - Trusted payment requirements.
 * @param payer - Authenticated Permit2 payer.
 * @param context - Registered Facilitator extensions.
 * @param requiredAllowance - Permit2 allowance required by the selected operation.
 * @param revalidate - Scheme-specific authorization checks repeated before Approval broadcast.
 * @returns Null on success/absence, otherwise a settlement failure.
 */
export async function executeTrc20Sponsorship(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  payer: string,
  context?: FacilitatorContext,
  requiredAllowance?: string,
  revalidate?: () => Promise<Trc20SponsorshipRevalidationResult>,
): Promise<SettleResponse | null> {
  const resolution = resolveSponsorship(payload, requirements, payer, context, requiredAllowance);
  if (resolution.state === "absent") return null;
  if (resolution.state === "invalid") {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: resolution.reason,
      errorMessage: resolution.message,
      payer,
    };
  }
  try {
    const result = await resolution.binding.runtime.sponsor(resolution.binding.request, {
      revalidate,
    });
    return result.success
      ? null
      : {
          success: false,
          network: payload.accepted.network,
          transaction: result.approvalTransaction ?? "",
          errorReason: result.errorReason ?? errors.SPONSOR_EXECUTION_FAILED,
          errorMessage: result.errorMessage,
          payer,
        };
  } catch {
    return {
      success: false,
      network: payload.accepted.network,
      transaction: "",
      errorReason: errors.SPONSOR_EXECUTION_FAILED,
      errorMessage: "Sponsorship execution failed",
      payer,
    };
  }
}
