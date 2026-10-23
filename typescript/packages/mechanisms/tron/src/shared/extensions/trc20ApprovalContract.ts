import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
  PaymentPayloadContext,
} from "@x402/core/types";

export const TRC20_APPROVAL_RESOURCE_SPONSORING_KEY = "trc20ApprovalResourceSponsoring" as const;
export const TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION = "1" as const;
/** Fixed minimum signed-transaction lifetime required by Extension version 1. */
export const TRC20_APPROVAL_LIFETIME_SECONDS = 600;
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
  /** Permit2 allowance required by the selected payment or deposit operation. */
  readonly requiredAllowance?: string;
  readonly signedTransaction: string;
  readonly paymentPayload: PaymentPayload;
  readonly paymentRequirements: PaymentRequirements;
}

export interface Trc20SponsorshipRevalidationResult {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
}

export interface Trc20SponsorshipExecutionOptions {
  /** Payment authorization deadline in Unix milliseconds. */
  readonly paymentDeadlineMs?: number;
  /** Revalidates the payment scheme after delegation and before Approval broadcast. */
  readonly revalidate?: () => Promise<Trc20SponsorshipRevalidationResult>;
}

export interface Trc20ApprovalResourceSponsoringVerification {
  readonly isValid: boolean;
  readonly invalidReason?: string;
  readonly invalidMessage?: string;
}

export interface Trc20ApprovalResourceSponsoringResult {
  readonly success: boolean;
  readonly approvalTransaction?: string;
  readonly errorReason?: string;
  readonly errorMessage?: string;
}

export interface Trc20ApprovalResourceSponsoringRuntime {
  verify(
    request: Trc20ApprovalResourceSponsoringRequest,
  ): Promise<Trc20ApprovalResourceSponsoringVerification>;
  sponsor(
    request: Trc20ApprovalResourceSponsoringRequest,
    options?: Trc20SponsorshipExecutionOptions,
  ): Promise<Trc20ApprovalResourceSponsoringResult>;
}

export interface Trc20ApprovalResourceSponsoringFacilitatorExtension {
  key: typeof TRC20_APPROVAL_RESOURCE_SPONSORING_KEY;
  verifyPayment?: (
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    payer: string,
    requiredAllowance?: string,
  ) => Promise<VerifyResponse | null>;
  executePayment?: (
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    payer: string,
    requiredAllowance?: string,
    deadline?: string,
    revalidate?: () => Promise<Trc20SponsorshipRevalidationResult>,
  ) => Promise<SettleResponse | null>;
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

/**
 * Whether a route declares resource sponsorship; implementation belongs to the extension.
 *
 * @param context - Advertised extension context.
 * @returns Whether the extension key is present.
 */
export function isTrc20ApprovalResourceSponsoringDeclared(
  context?: PaymentPayloadContext,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    context?.extensions ?? {},
    TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
  );
}

const CLIENT_PREPARED = Symbol.for("@bankofai/x402-tron/resource-approval-prepared");
/**
 * Mark only the newly created payload; symbols are not part of the wire message.
 *
 * @param payload - Payment produced by the registered client extension.
 * @returns A new payload with local preparation metadata.
 */
export function markTrc20ApprovalClientPrepared(payload: PaymentPayload): PaymentPayload {
  const prepared = { ...payload, [CLIENT_PREPARED]: true };
  return prepared;
}
/**
 * Reject an advertised extension that no registered client extension prepared.
 *
 * @param context - Official Core post-creation context.
 */
export async function assertTrc20ApprovalClientPrepared(
  context: import("@x402/core/client").PaymentCreatedContext,
): Promise<void> {
  const payload = context.paymentPayload as PaymentPayload & { [CLIENT_PREPARED]?: boolean };
  if (
    isTrc20ApprovalResourceSponsoringDeclared(context.paymentRequired) &&
    !payload[CLIENT_PREPARED]
  ) {
    throw new Error("trc20_approval_client_extension_not_registered");
  }
  delete payload[CLIENT_PREPARED];
}
