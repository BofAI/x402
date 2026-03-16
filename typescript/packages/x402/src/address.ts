/**
 * Address conversion utilities for x402 protocol
 * Handles conversion between TRON Base58 and EVM hex formats
 */

/** Hex address type */
export type Hex = `0x${string}`;

/** Base58 alphabet for TRON addresses */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Zero address in EVM hex format */
export const ZERO_ADDRESS_HEX: Hex = '0x0000000000000000000000000000000000000000';

/**
 * Address converter interface
 */
export interface AddressConverter {
  /** Normalize address to canonical format */
  normalize(address: string): string;
  /** Convert to EVM hex format (0x...) */
  toEvmFormat(address: string): Hex;
  /** Get zero address for this network type */
  getZeroAddress(): string;
  /** Convert all addresses in a message object */
  convertMessageAddresses(message: Record<string, unknown>): Record<string, unknown>;
}

/**
 * EVM address converter (passthrough)
 */
export class EvmAddressConverter implements AddressConverter {
  normalize(address: string): string {
    return address.toLowerCase();
  }

  toEvmFormat(address: string): Hex {
    if (!address.startsWith('0x')) {
      return `0x${address}` as Hex;
    }
    return address as Hex;
  }

  getZeroAddress(): string {
    return ZERO_ADDRESS_HEX;
  }

  convertMessageAddresses(message: Record<string, unknown>): Record<string, unknown> {
    // EVM addresses are already in correct format
    return message;
  }
}

/**
 * TRON address converter
 */
export class TronAddressConverter implements AddressConverter {
  normalize(address: string): string {
    // Return as-is for TRON (Base58 format)
    return address;
  }

  toEvmFormat(address: string): Hex {
    return toEvmHex(address);
  }

  getZeroAddress(): string {
    return 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb';
  }

  convertMessageAddresses(message: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    
    for (const [key, value] of Object.entries(message)) {
      if (typeof value === 'string' && this.isAddress(value)) {
        result[key] = this.toEvmFormat(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.convertMessageAddresses(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  private isAddress(value: string): boolean {
    // TRON Base58 address starts with T
    if (value.startsWith('T') && value.length === 34) return true;
    // TRON hex address starts with 41
    if (value.startsWith('41') && value.length === 42) return true;
    // EVM hex address
    if (value.startsWith('0x') && value.length === 42) return true;
    return false;
  }
}

/**
 * Convert TRON address to EVM hex format (0x...)
 * Handles: Base58 (T...), hex with 41 prefix, and 0x format
 */
export function toEvmHex(addr: string): Hex {
  // Handle null/undefined/empty
  if (!addr) {
    return ZERO_ADDRESS_HEX;
  }

  // Already 0x hex format
  if (addr.startsWith('0x')) {
    return addr as Hex;
  }

  // Handle special case: T followed by all zeros (invalid Base58 placeholder)
  if (addr.startsWith('T') && /^T0+$/.test(addr)) {
    return ZERO_ADDRESS_HEX;
  }
  
  // Raw hex (all hex characters, no prefix) - check this BEFORE Base58
  if (/^[0-9a-fA-F]+$/.test(addr)) {
    // If starts with 41 and is 42 chars, it's TRON hex format
    if (addr.startsWith('41') && addr.length === 42) {
      const body = addr.slice(2);
      return `0x${body}` as Hex;
    }
    // Otherwise treat as raw hex
    const body = addr.slice(-40).padStart(40, '0');
    return `0x${body}` as Hex;
  }

  // Base58 format (starts with T)
  if (addr.startsWith('T')) {
    return base58ToEvmHex(addr);
  }

  // Invalid format, return zero address
  console.warn(`[toEvmHex] Invalid address format: ${addr}, returning zero address`);
  return ZERO_ADDRESS_HEX;
}

/**
 * Convert Base58 address to EVM hex format
 */
function base58ToEvmHex(addr: string): Hex {
  const alphabetMap: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    alphabetMap[BASE58_ALPHABET[i]] = i;
  }

  let num = BigInt(0);
  for (const char of addr) {
    const value = alphabetMap[char];
    if (value === undefined) {
      console.warn(`[toEvmHex] Invalid Base58 character: ${char} in address: ${addr}`);
      return ZERO_ADDRESS_HEX;
    }
    num = num * BigInt(58) + BigInt(value);
  }

  let hex = num.toString(16);
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }

  // Remove checksum (last 4 bytes = 8 hex chars) and 41 prefix
  const withoutChecksum = hex.slice(0, -8);
  const body = withoutChecksum.startsWith('41') ? withoutChecksum.slice(2) : withoutChecksum;
  return `0x${body.padStart(40, '0')}` as Hex;
}

/**
 * Convert EVM hex address to TRON Base58 format
 */
export function toBase58(addr: string): string {
  if (!addr.startsWith('0x')) {
    return addr; // Already Base58 or other format
  }

  // Add TRON's 41 prefix
  const hexWithPrefix = '41' + addr.slice(2);
  
  // Convert to Base58 (simplified - in production use proper library)
  // This is a placeholder implementation
  let num = BigInt('0x' + hexWithPrefix);
  let result = '';

  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    result = BASE58_ALPHABET[remainder] + result;
    num = num / BigInt(58);
  }

  return result || 'T';
}
