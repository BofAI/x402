import { TRON_CHAIN_IDS } from "./constants";

declare var require: any;/**
 * Get the numeric chain ID for a TRON network identifier.
 *
 * @param network - The network identifier in CAIP-2 format (e.g., "tron:nile")
 * @returns The numeric chain ID
 * @throws Error if the network is not a recognized TRON network
 */
export function getTronChainId(network: string): number {
  if (!network.startsWith("tron:")) {
    throw new Error(`Unsupported network format: ${network} (expected tron:*)`);
  }

  const chainId = TRON_CHAIN_IDS[network];
  if (chainId === undefined) {
    throw new Error(`Unknown TRON network: ${network}`);
  }

  return chainId;
}

/**
 * Get the crypto object from the global scope.
 */
function getCrypto(): any {
  const cryptoObj = (globalThis as any).crypto;
  if (!cryptoObj) {
    throw new Error("Crypto API not available");
  }
  return cryptoObj;
}

/**
 * Create a random 32-byte nonce for TIP-712 authorization.
 */
export function createNonce(): `0x${string}` {
  const bytes = getCrypto().getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes as Iterable<number>)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

/**
 * Convert a TRON Base58Check address to EVM hex address (0x-prefixed).
 * TRON addresses are Base58Check-encoded with a 0x41 prefix.
 */
export function tronAddressToEvm(tronAddress: string): `0x${string}` {
  if (tronAddress.startsWith("0x")) {
    return tronAddress.toLowerCase() as `0x${string}`;
  }

  // TRON hex format (41-prefixed, 42 chars)
  if (tronAddress.startsWith("41") && tronAddress.length === 42) {
    return `0x${tronAddress.slice(2).toLowerCase()}` as `0x${string}`;
  }

  // Base58Check format - decode manually
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(0);
  for (const char of tronAddress) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid Base58 character: ${char}`);
    }
    num = num * BigInt(58) + BigInt(index);
  }

  // Convert to bytes (25 bytes: 1 version + 20 address + 4 checksum)
  let hex = num.toString(16);
  while (hex.length < 50) {
    hex = "0" + hex;
  }

  // Skip version byte (0x41) and checksum (4 bytes), extract 20-byte address
  const addressHex = hex.slice(2, 42);
  return `0x${addressHex.toLowerCase()}` as `0x${string}`;
}

/**
 * Convert an EVM hex address to TRON Base58Check address.
 */
export function evmAddressToTron(evmAddress: string): string {
  const cleanAddr = evmAddress.startsWith("0x") ? evmAddress.slice(2) : evmAddress;
  const addressWithPrefix = "41" + cleanAddr.toLowerCase();

  const bytes = hexToBytes(addressWithPrefix);
  const hash1 = sha256(bytes);
  const hash2 = sha256(hash1);
  const checksum = hash2.slice(0, 4);

  const fullBytes = new Uint8Array(bytes.length + checksum.length);
  fullBytes.set(bytes);
  fullBytes.set(checksum, bytes.length);

  return base58Encode(fullBytes);
}

/**
 * Check if a string looks like a TRON Base58Check address.
 */
export function isTronAddress(address: string): boolean {
  return address.startsWith("T") && address.length === 34;
}

/**
 * Normalize an address for signing: TRON Base58 → EVM hex, or pass through hex.
 */
export function normalizeAddressForSigning(address: string): `0x${string}` {
  if (isTronAddress(address)) {
    return tronAddressToEvm(address);
  }
  if (address.startsWith("0x")) {
    return address.toLowerCase() as `0x${string}`;
  }
  if (address.startsWith("41") && address.length === 42) {
    return `0x${address.slice(2).toLowerCase()}` as `0x${string}`;
  }
  throw new Error(`Unrecognized address format: ${address}`);
}

// --- Internal helpers ---

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function sha256(data: Uint8Array): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  return new Uint8Array(crypto.createHash("sha256").update(data).digest());
}

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }

  let result = "";
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    num = num / BigInt(58);
    result = ALPHABET[remainder] + result;
  }

  for (const byte of bytes) {
    if (byte === 0) {
      result = "1" + result;
    } else {
      break;
    }
  }

  return result;
}
