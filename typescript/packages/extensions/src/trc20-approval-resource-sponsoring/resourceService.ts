import { trc20ApprovalResourceSponsoringSchema } from "./schema.js";
import {
  TRC20_APPROVAL_RESOURCE_SPONSORING,
  TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
  type Trc20ApprovalResourceSponsoringExtension,
} from "./types.js";

export { trc20ApprovalResourceSponsoringSchema } from "./schema.js";
/**
 * Declares TRC-20 Approval Resource Sponsoring in PaymentRequired.extensions.
 *
 * @returns Extension declaration keyed by its canonical identifier.
 */
export function declareTrc20ApprovalResourceSponsoringExtension(): Record<
  string,
  Trc20ApprovalResourceSponsoringExtension
> {
  return {
    [TRC20_APPROVAL_RESOURCE_SPONSORING.key]: {
      info: {
        description:
          "The facilitator sponsors TRON Energy and Bandwidth for a pre-signed TRC-20 approve transaction.",
        version: TRC20_APPROVAL_RESOURCE_SPONSORING_VERSION,
      },
      schema: trc20ApprovalResourceSponsoringSchema,
    },
  };
}
