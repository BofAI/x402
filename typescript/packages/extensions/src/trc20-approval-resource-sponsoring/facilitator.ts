import Ajv from "ajv/dist/2020.js";
import type { PaymentPayload } from "@bankofai/x402-core/types";
import { trc20ApprovalResourceSponsoringSchema } from "./resourceService";
import {
  TRC20_APPROVAL_RESOURCE_SPONSORING,
  type Trc20ApprovalResourceSponsoringExtension,
  type Trc20ApprovalResourceSponsoringFacilitatorExtension,
  type Trc20ApprovalResourceSponsoringInfo,
  type Trc20ApprovalResourceSponsoringRuntime,
} from "./types";

const ajv = new Ajv({ strict: false, allErrors: true });
const validateInfo = ajv.compile(trc20ApprovalResourceSponsoringSchema);

/**
 * Extracts complete Client info from a payment payload, or null when absent/incomplete.
 *
 * @param paymentPayload - Payment payload that may contain the Extension.
 * @returns Complete Client info or null.
 */
export function extractTrc20ApprovalResourceSponsoringInfo(
  paymentPayload: PaymentPayload,
): Trc20ApprovalResourceSponsoringInfo | null {
  const extension = paymentPayload.extensions?.[TRC20_APPROVAL_RESOURCE_SPONSORING.key] as
    | Trc20ApprovalResourceSponsoringExtension
    | undefined;
  const info = extension?.info as Record<string, unknown> | undefined;
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
 * Validates Client info against the canonical version 1 wire schema.
 *
 * @param info - Client-provided Extension info.
 * @returns Whether info matches the pinned schema.
 */
export function validateTrc20ApprovalResourceSponsoringInfo(
  info: Trc20ApprovalResourceSponsoringInfo,
): boolean {
  return validateInfo(info) as boolean;
}

/**
 * Resolves a network-specific runtime, falling back to the default runtime.
 *
 * @param extension - Registered Facilitator Extension.
 * @param network - Payment network.
 * @returns Network-specific or default runtime.
 */
export function resolveTrc20ApprovalResourceSponsoringRuntime(
  extension: Trc20ApprovalResourceSponsoringFacilitatorExtension | undefined,
  network: string,
): Trc20ApprovalResourceSponsoringRuntime | undefined {
  return extension?.runtimeForNetwork?.(network) ?? extension?.runtime;
}
