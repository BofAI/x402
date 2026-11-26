import type { PaymentRequirements } from "@x402/core/types";
import type { ExactTronPayload } from "../../types";
import { isRecord, isTronPaymentAddress, isUint256 } from "../../shared/validation";
import { validateExactRequirements } from "../requirements";
import { INVALID_PAY_TO } from "./errors";

/**
 * Validate the terms used by exact verification and settlement.
 *
 * @param requirements - Payment requirements from the request.
 * @returns The resolved transfer method or a protocol error.
 */
export function validateExactFacilitatorRequirements(
  requirements: PaymentRequirements,
): ReturnType<typeof validateExactRequirements> {
  const result = validateExactRequirements(requirements);
  return result.success && !isTronPaymentAddress(requirements.payTo)
    ? { success: false, reason: INVALID_PAY_TO }
    : result;
}

/**
 * Check the fields used by exact verifiers before accessing nested authorization
 * objects or converting untrusted integer strings.
 *
 * @param value - Untrusted exact payload.
 * @returns Whether it contains one complete supported authorization.
 */
export function isValidExactPayload(value: unknown): value is ExactTronPayload {
  if (!isRecord(value) || typeof value.signature !== "string" || !value.signature) return false;
  if ("permit2Authorization" in value && "authorization" in value) return false;
  if ("permit2Authorization" in value) {
    const auth = value.permit2Authorization;
    return (
      isRecord(auth) &&
      isTronPaymentAddress(auth.from) &&
      isTronPaymentAddress(auth.spender) &&
      isUint256(auth.nonce) &&
      isUint256(auth.deadline) &&
      isRecord(auth.permitted) &&
      isTronPaymentAddress(auth.permitted.token) &&
      isUint256(auth.permitted.amount) &&
      isRecord(auth.witness) &&
      isTronPaymentAddress(auth.witness.to) &&
      isUint256(auth.witness.validAfter)
    );
  }
  const auth = value.authorization;
  return (
    isRecord(auth) &&
    isTronPaymentAddress(auth.from) &&
    isTronPaymentAddress(auth.to) &&
    isUint256(auth.value) &&
    isUint256(auth.validAfter) &&
    isUint256(auth.validBefore) &&
    typeof auth.nonce === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(auth.nonce)
  );
}
