import { normalizeAddressForSigning } from "../utils";

/**
 * Check a nested object without accepting arrays or null.
 *
 * @param value - Untrusted nested field.
 * @returns Whether it is an object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check an address before passing it to typed-data verification.
 *
 * @param value - Untrusted address.
 * @returns Whether it normalizes to an address.
 */
export function isTronPaymentAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return /^0x[0-9a-f]{40}$/.test(normalizeAddressForSigning(value));
  } catch {
    return false;
  }
}

/**
 * Check an unsigned 256-bit integer without allowing BigInt coercion of empty
 * strings, negative values, or JSON numbers.
 *
 * @param value - Untrusted integer field.
 * @returns Whether the field can be safely used as a contract uint256.
 */
export function isUint256(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(value) &&
    BigInt(value) < 1n << 256n
  );
}
