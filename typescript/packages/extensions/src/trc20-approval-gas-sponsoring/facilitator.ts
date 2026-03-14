import Ajv from "ajv/dist/2020.js";
import type { PaymentPayload } from "@bankofai/x402-core/types";
import {
  TRC20_APPROVAL_GAS_SPONSORING,
  type Trc20ApprovalGasSponsoringExtension,
  type Trc20ApprovalGasSponsoringInfo,
} from "./types";
import { trc20ApprovalGasSponsoringSchema } from "./resourceService";

export function extractTrc20ApprovalGasSponsoringInfo(
  paymentPayload: PaymentPayload,
): Trc20ApprovalGasSponsoringInfo | null {
  if (!paymentPayload.extensions) {
    return null;
  }

  const extension = paymentPayload.extensions[TRC20_APPROVAL_GAS_SPONSORING.key] as
    | Trc20ApprovalGasSponsoringExtension
    | undefined;

  if (!extension?.info) {
    return null;
  }

  const info = extension.info as Record<string, unknown>;
  if (
    !info.from ||
    !info.asset ||
    !info.spender ||
    !info.amount ||
    !info.signedTransaction ||
    !info.version
  ) {
    return null;
  }

  return info as Trc20ApprovalGasSponsoringInfo;
}

export function validateTrc20ApprovalGasSponsoringInfo(
  info: Trc20ApprovalGasSponsoringInfo,
): boolean {
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(trc20ApprovalGasSponsoringSchema);
  return validate(info) as boolean;
}
