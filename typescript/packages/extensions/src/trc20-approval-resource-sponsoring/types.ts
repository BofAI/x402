import type {
  Trc20ApprovalResourceSponsoringRuntime,
  Trc20ApprovalResourceSponsoringFacilitatorExtension,
  Trc20ApprovalResourceSponsoringInfo,
} from "@bankofai/x402-tron/exact/extensions";
import { TRC20_APPROVAL_RESOURCE_SPONSORING_KEY } from "@bankofai/x402-tron/exact/extensions";
import { verifyTrc20Sponsorship, executeTrc20Sponsorship } from "./facilitatorPayment.js";
export * from "@bankofai/x402-tron/exact/extensions";
export const TRC20_APPROVAL_RESOURCE_SPONSORING = {
  key: TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
} as const;
/** Server-provided declaration metadata. */
export interface Trc20ApprovalResourceSponsoringServerInfo {
  readonly [key: string]: unknown;
  readonly description: string;
  readonly version: string;
}

/** Extension declaration/payload envelope. */
export interface Trc20ApprovalResourceSponsoringExtension {
  info: Trc20ApprovalResourceSponsoringServerInfo | Trc20ApprovalResourceSponsoringInfo;
  schema: Record<string, unknown>;
}

/**
 * Register complete resource verification and execution capabilities with official Core.
 *
 * @param runtime - Default resource runtime.
 * @param runtimeForNetwork - Optional per-network resolver.
 * @returns Official facilitator extension with payment capabilities.
 */
export function createTrc20ApprovalResourceSponsoringExtension(
  runtime: Trc20ApprovalResourceSponsoringRuntime,
  runtimeForNetwork?: (network: string) => Trc20ApprovalResourceSponsoringRuntime | undefined,
): Trc20ApprovalResourceSponsoringFacilitatorExtension {
  const extension: Trc20ApprovalResourceSponsoringFacilitatorExtension = {
    key: TRC20_APPROVAL_RESOURCE_SPONSORING_KEY,
    runtime,
    runtimeForNetwork,
    verifyPayment: (p, r, payer, amount) => verifyTrc20Sponsorship(p, r, payer, extension, amount),
    executePayment: (p, r, payer, amount, deadline, revalidate) =>
      executeTrc20Sponsorship(p, r, payer, extension, amount, deadline, revalidate),
  };
  return extension;
}
