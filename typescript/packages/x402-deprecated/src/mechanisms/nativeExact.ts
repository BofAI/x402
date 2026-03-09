/**
 * Shared types and helpers for exact mechanism.
 *
 * exact uses ERC-3009 TransferWithAuthorization for direct token transfers
 * without going through a PaymentPermit contract.
 */

import type { Hex } from '../address.js';

/** Scheme name */
export const SCHEME_EXACT = 'exact';

/** Default validity period (1 hour) */
export const DEFAULT_VALIDITY_SECONDS = 3600;

/** TransferWithAuthorization parameters */
export interface TransferAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string; // 32-byte hex string (0x...)
}

/**
 * EIP-712 type definitions for TransferWithAuthorization
 * Note: domain includes "version" field (unlike PaymentPermit)
 */
export const TRANSFER_AUTH_EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export const TRANSFER_AUTH_PRIMARY_TYPE = 'TransferWithAuthorization';

/**
 * Build EIP-712 domain for exact
 */
export function buildEip712Domain(
  tokenName: string,
  tokenVersion: string,
  chainId: number,
  verifyingContract: string,
): Record<string, unknown> {
  return {
    name: tokenName,
    version: tokenVersion,
    chainId,
    verifyingContract,
  };
}

/**
 * Build EIP-712 message from TransferAuthorization
 */
export function buildEip712Message(
  auth: TransferAuthorization,
  toSigningAddress: (addr: string) => Hex,
): Record<string, unknown> {
  return {
    from: toSigningAddress(auth.from),
    to: toSigningAddress(auth.to),
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };
}

/**
 * Generate a random 32-byte nonce (0x-prefixed hex)
 */
export function createNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create (validAfter, validBefore) timestamps.
 * Adds a 30-second buffer before now to account for clock skew.
 */
export function createValidityWindow(
  duration: number = DEFAULT_VALIDITY_SECONDS,
): [number, number] {
  const now = Math.floor(Date.now() / 1000);
  return [now - 30, now + duration];
}
