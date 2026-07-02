import { TronWeb } from "tronweb";
import { TRON_CHAIN_IDS } from "./constants";

/**
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
 *
 * @returns The Crypto object.
 */
function getCrypto(): Crypto {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (!cryptoObj) {
    throw new Error("Crypto API not available");
  }
  return cryptoObj;
}

/**
 * Create a random 32-byte nonce for TIP-712 authorization.
 *
 * @returns A 32-byte hex-encoded nonce.
 */
export function createNonce(): `0x${string}` {
  const bytes = getCrypto().getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes as Iterable<number>)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

/**
 * Convert a TRON Base58Check address to EVM hex address (0x-prefixed).
 * TRON addresses are Base58Check-encoded with a 0x41 prefix.
 *
 * @param tronAddress - The TRON address in Base58Check format.
 * @returns The EVM-compatible hex address.
 */
export function tronAddressToEvm(tronAddress: string): `0x${string}` {
  if (tronAddress.startsWith("0x")) {
    return tronAddress.toLowerCase() as `0x${string}`;
  }

  // TRON hex format (41-prefixed, 42 chars)
  if (tronAddress.startsWith("41") && tronAddress.length === 42) {
    return `0x${tronAddress.slice(2).toLowerCase()}` as `0x${string}`;
  }

  return TronWeb.address.toHex(tronAddress).toLowerCase().replace(/^41/, "0x") as `0x${string}`;
}

/**
 * Convert an EVM hex address to TRON Base58Check address.
 *
 * @param evmAddress - The hex address to convert.
 * @returns The TRON Base58Check address.
 */
export function evmAddressToTron(evmAddress: string): string {
  const cleanAddr = evmAddress.startsWith("0x") ? evmAddress.slice(2) : evmAddress;
  const tronHex = cleanAddr.startsWith("41")
    ? cleanAddr.toLowerCase()
    : `41${cleanAddr.toLowerCase()}`;
  return TronWeb.address.fromHex(tronHex);
}

/**
 * Check if a string looks like a TRON Base58Check address.
 *
 * @param address - The address to check.
 * @returns True if it looks like a TRON address.
 */
export function isTronAddress(address: string): boolean {
  return address.startsWith("T") && address.length === 34;
}

/**
 * Normalize an address for signing: TRON Base58 → EVM hex, or pass through hex.
 *
 * @param address - The address to normalize.
 * @returns The normalized hex address.
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
