import type {
  FacilitatorExtension,
  PaymentPayload,
  PaymentRequirements,
} from "@bankofai/x402-core/types";

/** Extension identifier for TRC-20 Approval Resource Sponsoring. */
export const TRC20_APPROVAL_RESOURCE_SPONSORING = {
  key: "trc20ApprovalResourceSponsoring",
} as const satisfies FacilitatorExtension;

/** Current wire-schema version. */
export const TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION = "1";

/** Unlimited TRC-20 approval amount (`type(uint256).max`). */
export const TRC20_APPROVAL_MAX_AMOUNT =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/** Client-populated extension information. */
export interface Trc20ApprovalResourceSponsoringInfo {
  [key: string]: unknown;
  /** Payer and Approval signer in TRON Base58Check form. */
  from: string;
  /** TRC-20 contract in TRON Base58Check form. */
  asset: string;
  /** Canonical Permit2 contract in TRON Base58Check form. */
  spender: string;
  /** Approval amount as a decimal string. Version 1 requires MaxUint256. */
  amount: string;
  /** Complete signed TRON Transaction protobuf as lowercase hex without `0x`. */
  signedTransaction: string;
  /** Extension schema version. */
  version: string;
}

/** Server-provided declaration metadata. */
export interface Trc20ApprovalResourceSponsoringServerInfo {
  [key: string]: unknown;
  description: string;
  version: string;
}

/** Extension declaration/payload envelope. */
export interface Trc20ApprovalResourceSponsoringExtension {
  info: Trc20ApprovalResourceSponsoringServerInfo | Trc20ApprovalResourceSponsoringInfo;
  schema: Record<string, unknown>;
}

/** Request passed to a Facilitator's resource-sponsoring runtime. */
export interface Trc20ApprovalResourceSponsoringRequest {
  network: string;
  approvalTxID: string;
  approvalTimestamp: string;
  approvalExpiration: string;
  approvalFeeLimitSun: string;
  payer: string;
  asset: string;
  spender: string;
  amount: string;
  signedTransaction: string;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/** Read-only runtime verification result. */
export interface Trc20ApprovalResourceSponsoringVerification {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
}

/** Result of executing the sponsored Approval lifecycle. */
export interface Trc20ApprovalResourceSponsoringResult {
  success: boolean;
  approvalTransaction?: string;
  errorReason?: string;
  errorMessage?: string;
}

/**
 * Facilitator-owned runtime for chain reads, policy admission, resource
 * delegation, Approval broadcast, and resource reclamation.
 */
export interface Trc20ApprovalResourceSponsoringRuntime {
  verify(
    request: Trc20ApprovalResourceSponsoringRequest,
  ): Promise<Trc20ApprovalResourceSponsoringVerification>;
  sponsor(
    request: Trc20ApprovalResourceSponsoringRequest,
  ): Promise<Trc20ApprovalResourceSponsoringResult>;
}

/** Facilitator extension carrying the resource-sponsoring runtime. */
export interface Trc20ApprovalResourceSponsoringFacilitatorExtension extends FacilitatorExtension {
  key: "trc20ApprovalResourceSponsoring";
  runtime?: Trc20ApprovalResourceSponsoringRuntime;
  runtimeForNetwork?: (network: string) => Trc20ApprovalResourceSponsoringRuntime | undefined;
}

/**
 * Creates a Facilitator extension backed by a resource-sponsoring runtime.
 *
 * @param runtime - Default runtime used for every network.
 * @param runtimeForNetwork - Optional network-specific runtime resolver.
 * @returns Facilitator Extension ready for registration.
 */
export function createTrc20ApprovalResourceSponsoringExtension(
  runtime: Trc20ApprovalResourceSponsoringRuntime,
  runtimeForNetwork?: (network: string) => Trc20ApprovalResourceSponsoringRuntime | undefined,
): Trc20ApprovalResourceSponsoringFacilitatorExtension {
  return { ...TRC20_APPROVAL_RESOURCE_SPONSORING, runtime, runtimeForNetwork };
}
