import type {
  FacilitatorContext,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from "@x402/core/types";
import {
  TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  extractTrc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringFacilitatorExtension,
  type Trc20SponsorshipRevalidationResult,
} from "./trc20ApprovalContract";

/**
 * Dispatch verification to an independently registered resource capability.
 *
 * @param payload - Payment envelope.
 * @param requirements - Trusted payment requirements.
 * @param payer - Verified authorization payer.
 * @param context - Official facilitator extension registry.
 * @param requiredAllowance - Selected operation's allowance amount.
 * @returns Extension verification or null for ordinary payments.
 */
export async function verifyTrc20Sponsorship(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  payer: string,
  context?: FacilitatorContext,
  requiredAllowance?: string,
): Promise<VerifyResponse | null> {
  if (
    !Object.prototype.hasOwnProperty.call(
      payload.extensions ?? {},
      TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
    )
  )
    return null;
  if (!extractTrc20ApprovalResourceSponsoringInfo(payload))
    return { isValid: false, invalidReason: "approval_extension_invalid", payer };
  const extension = context?.getExtension<Trc20ApprovalResourceSponsoringFacilitatorExtension>(
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
  if (!extension?.verifyPayment)
    return { isValid: false, invalidReason: "sponsor_runtime_unavailable", payer };
  try {
    return await extension.verifyPayment(payload, requirements, payer, requiredAllowance);
  } catch {
    return { isValid: false, invalidReason: "sponsor_policy_denied", payer };
  }
}

/**
 * Dispatch resource execution to the registered extension before settlement.
 *
 * @param payload - Payment envelope.
 * @param requirements - Trusted payment requirements.
 * @param payer - Verified authorization payer.
 * @param context - Official facilitator extension registry.
 * @param requiredAllowance - Selected operation's allowance amount.
 * @param paymentDeadlineSeconds - Authorization deadline.
 * @param revalidate - Scheme checks before broadcasting Approval.
 * @returns Failure response or null when settlement may proceed.
 */
export async function executeTrc20Sponsorship(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  payer: string,
  context?: FacilitatorContext,
  requiredAllowance?: string,
  paymentDeadlineSeconds?: string,
  revalidate?: () => Promise<Trc20SponsorshipRevalidationResult>,
): Promise<SettleResponse | null> {
  if (
    !Object.prototype.hasOwnProperty.call(
      payload.extensions ?? {},
      TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
    )
  )
    return null;
  const extension = context?.getExtension<Trc20ApprovalResourceSponsoringFacilitatorExtension>(
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
  if (!extractTrc20ApprovalResourceSponsoringInfo(payload) || !extension?.executePayment)
    return {
      success: false,
      network: requirements.network,
      transaction: "",
      payer,
      errorReason: extension?.executePayment
        ? "approval_extension_invalid"
        : "sponsor_runtime_unavailable",
    };
  try {
    return await extension.executePayment(
      payload,
      requirements,
      payer,
      requiredAllowance,
      paymentDeadlineSeconds,
      revalidate,
    );
  } catch {
    return {
      success: false,
      network: requirements.network,
      transaction: "",
      payer,
      errorReason: "sponsor_execution_failed",
    };
  }
}
