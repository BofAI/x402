import Ajv from "ajv/dist/2020.js";
import { trc20ApprovalResourceSponsoringSchema } from "./schema.js";
import type { Trc20ApprovalResourceSponsoringInfo } from "@bankofai/x402-tron/exact/extensions";
const validate = new Ajv({ strict: false, allErrors: true }).compile(
  trc20ApprovalResourceSponsoringSchema,
);
/**
 * Check client info against the canonical wire schema, independent of the advertised schema.
 *
 * @param info - Untrusted client extension information.
 * @returns Whether the client fields match the canonical schema.
 */
export function validateTrc20ApprovalResourceSponsoringInfo(
  info: unknown,
): info is Trc20ApprovalResourceSponsoringInfo {
  return validate(info) as boolean;
}
