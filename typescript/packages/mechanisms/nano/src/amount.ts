import { XNO_DECIMALS } from "./network";

/** Raw units in one XNO (10^30). */
export const RAW_PER_XNO = 10n ** BigInt(XNO_DECIMALS);

/** Largest representable Nano balance (2^128 - 1 raw). */
export const MAX_RAW = (1n << 128n) - 1n;

/**
 * Parse a raw amount string (a base-10 integer, no sign, no exponent, no
 * leading zeros) into a bigint.
 *
 * @param value - Raw amount as a string.
 * @returns The amount in raw.
 */
export function parseRaw(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid raw amount: ${String(value)}`);
  }
  const raw = BigInt(value);
  if (raw > MAX_RAW) {
    throw new Error(`Raw amount exceeds 2^128 - 1: ${value}`);
  }
  return raw;
}

/**
 * Convert a decimal XNO string to raw. Only plain decimal strings are
 * accepted: numbers, exponents, signs and more than 30 decimals are refused,
 * so no value is ever rounded.
 *
 * @param value - XNO amount as a decimal string (e.g. "0.001").
 * @returns The amount in raw.
 */
export function xnoToRaw(value: string): bigint {
  if (typeof value !== "string") {
    throw new Error("XNO amount must be a decimal string, not a number");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid XNO amount: ${value}`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > XNO_DECIMALS) {
    throw new Error(`XNO amount has more than ${XNO_DECIMALS} decimals: ${value}`);
  }
  const raw = BigInt(match[1]) * RAW_PER_XNO + BigInt(fraction.padEnd(XNO_DECIMALS, "0"));
  if (raw > MAX_RAW) {
    throw new Error(`XNO amount exceeds 2^128 - 1 raw: ${value}`);
  }
  return raw;
}

/**
 * Format a raw amount as a decimal XNO string without trailing zeros.
 *
 * @param raw - Amount in raw.
 * @returns The amount in XNO.
 */
export function rawToXno(raw: bigint): string {
  if (raw < 0n) {
    throw new Error("Raw amount must not be negative");
  }
  const whole = raw / RAW_PER_XNO;
  const fraction = (raw % RAW_PER_XNO).toString().padStart(XNO_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
