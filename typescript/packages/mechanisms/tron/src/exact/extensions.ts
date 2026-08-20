import type { PaymentPayload, PaymentRequirements } from "@bankofai/x402-core/types";

export const TRC20_APPROVAL_RESOURCE_SPONSORING_KEY = "trc20ApprovalResourceSponsoring" as const;
export const TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION = "1" as const;
export const TRC20_APPROVAL_MAX_AMOUNT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

export interface Trc20ApprovalResourceSponsoringInfo {
  readonly [key: string]: unknown;
  readonly from: string;
  readonly asset: string;
  readonly spender: string;
  readonly amount: string;
  readonly signedTransaction: string;
  readonly version: string;
}

export interface Trc20ApprovalResourceSponsoringRequest {
  readonly network: string;
  readonly approvalTxID: string;
  readonly approvalTimestamp: string;
  readonly approvalExpiration: string;
  readonly approvalFeeLimitSun: string;
  readonly approvalRefBlockBytes: string;
  readonly approvalRefBlockHash: string;
  readonly payer: string;
  readonly asset: string;
  readonly spender: string;
  readonly amount: string;
  readonly signedTransaction: string;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
}

export interface Trc20ApprovalResourceSponsoringRuntime {
  verify(request: Trc20ApprovalResourceSponsoringRequest): Promise<{
    isValid: boolean;
    invalidReason?: string;
    invalidMessage?: string;
  }>;
  sponsor(request: Trc20ApprovalResourceSponsoringRequest): Promise<{
    success: boolean;
    approvalTransaction?: string;
    errorReason?: string;
    errorMessage?: string;
  }>;
}

export interface Trc20ApprovalResourceSponsoringFacilitatorExtension {
  key: typeof TRC20_APPROVAL_RESOURCE_SPONSORING_KEY;
  runtime?: Trc20ApprovalResourceSponsoringRuntime;
  runtimeForNetwork?: (network: string) => Trc20ApprovalResourceSponsoringRuntime | undefined;
}

/**
 * Extracts complete version 1 info from a payment payload.
 *
 * @param payload - Payment payload that may contain the extension.
 * @returns Complete info or null when absent/incomplete.
 */
export function extractTrc20ApprovalResourceSponsoringInfo(
  payload: PaymentPayload,
): Trc20ApprovalResourceSponsoringInfo | null {
  const extension = payload.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING_KEY] as
    | { info?: Record<string, unknown> }
    | undefined;
  const info = extension?.info;
  if (
    !info?.from ||
    !info.asset ||
    !info.spender ||
    !info.amount ||
    !info.signedTransaction ||
    !info.version
  ) {
    return null;
  }
  return info as unknown as Trc20ApprovalResourceSponsoringInfo;
}

/**
 * Resolves the registered runtime for a network.
 *
 * @param extension - Registered Facilitator extension.
 * @param network - Payment network.
 * @returns The network-specific or default runtime.
 */
export function resolveTrc20ApprovalResourceSponsoringRuntime(
  extension: Trc20ApprovalResourceSponsoringFacilitatorExtension | undefined,
  network: string,
): Trc20ApprovalResourceSponsoringRuntime | undefined {
  return extension?.runtimeForNetwork?.(network) ?? extension?.runtime;
}
