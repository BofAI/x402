import { blake2b } from "@noble/hashes/blake2b";

/** Nano's base32 alphabet (no 0, 2, l or v). */
const NANO_ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";

const ADDRESS_PATTERN = /^(nano|xrb)_([13][13456789abcdefghijkmnopqrstuwxyz]{59})$/;

/**
 * Encode bytes as Nano base32. The bit string is left-padded with zeros to a
 * multiple of 5 bits, which is how Nano encodes both the 256-bit public key
 * (4 padding bits) and the 40-bit checksum (no padding).
 *
 * @param bytes - Bytes to encode.
 * @returns The base32 string.
 */
function encodeBase32(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const padding = (5 - (bitLength % 5)) % 5;
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  const chars = (bitLength + padding) / 5;
  let out = "";
  for (let i = chars - 1; i >= 0; i--) {
    out += NANO_ALPHABET[Number((value >> BigInt(i * 5)) & 31n)];
  }
  return out;
}

/**
 * Decode a Nano base32 string into a fixed number of bytes.
 *
 * @param text - Base32 text using the Nano alphabet.
 * @param byteLength - Expected number of output bytes.
 * @returns The decoded bytes.
 */
function decodeBase32(text: string, byteLength: number): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const index = NANO_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`Invalid Nano base32 character: ${char}`);
    }
    value = (value << 5n) | BigInt(index);
  }
  if (value >> BigInt(byteLength * 8) !== 0n) {
    throw new Error("Nano base32 value overflows the expected length");
  }
  const out = new Uint8Array(byteLength);
  for (let i = byteLength - 1; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

/**
 * Compute the 5-byte Nano address checksum: blake2b-40 of the public key,
 * byte-reversed.
 *
 * @param publicKey - 32-byte account public key.
 * @returns The 5 checksum bytes.
 */
function addressChecksum(publicKey: Uint8Array): Uint8Array {
  return blake2b(publicKey, { dkLen: 5 }).reverse();
}

/**
 * Encode a 32-byte public key as a `nano_` address.
 *
 * @param publicKey - 32-byte account public key.
 * @returns The checksummed `nano_` address.
 */
export function encodeNanoAddress(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error("Nano public key must be 32 bytes");
  }
  return `nano_${encodeBase32(publicKey)}${encodeBase32(addressChecksum(publicKey))}`;
}

/**
 * Decode a `nano_` or legacy `xrb_` address to its 32-byte public key,
 * verifying the checksum.
 *
 * @param address - The address to decode.
 * @returns The 32-byte public key.
 */
export function decodeNanoAddress(address: string): Uint8Array {
  const match = typeof address === "string" ? ADDRESS_PATTERN.exec(address) : null;
  if (!match) {
    throw new Error(`Invalid Nano address format: ${String(address)}`);
  }
  const body = match[2];
  const publicKey = decodeBase32(body.slice(0, 52), 32);
  const checksum = decodeBase32(body.slice(52), 5);
  const expected = addressChecksum(publicKey);
  for (let i = 0; i < 5; i++) {
    if (checksum[i] !== expected[i]) {
      throw new Error(`Invalid Nano address checksum: ${address}`);
    }
  }
  return publicKey;
}

/**
 * Check whether a string is a well-formed, correctly checksummed Nano address.
 *
 * @param address - Candidate address.
 * @returns Whether the address is valid.
 */
export function isNanoAddress(address: string): boolean {
  try {
    decodeNanoAddress(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the account public key of a Nano address as uppercase hex.
 *
 * @param address - A `nano_` or `xrb_` address.
 * @returns The 64-character uppercase hex public key.
 */
export function nanoAddressToPublicKey(address: string): string {
  return bytesToHex(decodeNanoAddress(address));
}

/**
 * Compare two Nano addresses by public key, so `nano_` and `xrb_` forms of
 * the same account are equal.
 *
 * @param left - First address.
 * @param right - Second address.
 * @returns Whether both are valid and refer to the same account.
 */
export function nanoAddressesEqual(left: string, right: string): boolean {
  try {
    return nanoAddressToPublicKey(left) === nanoAddressToPublicKey(right);
  } catch {
    return false;
  }
}

/**
 * Format bytes as uppercase hex.
 *
 * @param bytes - Bytes to format.
 * @returns Uppercase hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out.toUpperCase();
}
