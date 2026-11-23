import type { ExactTronPayload } from "../../types";
import { normalizeAddressForSigning } from "../../utils";
import { isUint256 } from "../requirements";

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
      isAddress(auth.from) &&
      isAddress(auth.spender) &&
      isUint256(auth.nonce) &&
      isUint256(auth.deadline) &&
      isRecord(auth.permitted) &&
      isAddress(auth.permitted.token) &&
      isUint256(auth.permitted.amount) &&
      isRecord(auth.witness) &&
      isAddress(auth.witness.to) &&
      isUint256(auth.witness.validAfter)
    );
  }
  const auth = value.authorization;
  return (
    isRecord(auth) &&
    isAddress(auth.from) &&
    isAddress(auth.to) &&
    isUint256(auth.value) &&
    isUint256(auth.validAfter) &&
    isUint256(auth.validBefore) &&
    typeof auth.nonce === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(auth.nonce)
  );
}

/**
 * Check a nested object without accepting arrays or null.
 *
 * @param value - Untrusted nested field.
 * @returns Whether it is an object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check an address before passing it to typed-data verification.
 *
 * @param value - Untrusted address.
 * @returns Whether it normalizes to an address.
 */
function isAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return /^0x[0-9a-f]{40}$/.test(normalizeAddressForSigning(value));
  } catch {
    return false;
  }
}
