/**
 * ABI and EIP-712 type definitions for x402 protocol
 * Shared across all mechanisms
 */

import type { DeliveryKind } from './types/payment.js';

/** EIP-712 Primary Type for PaymentPermit */
export const PAYMENT_PERMIT_PRIMARY_TYPE = 'PaymentPermitDetails';

/** EIP-712 Primary Type for GasFree */
export const GASFREE_PRIMARY_TYPE = 'PermitTransfer';

/**
 * EIP-712 Domain Type for PaymentPermit
 */
export const PAYMENT_PERMIT_EIP712_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

/**
 * EIP-712 Domain Type for GasFree
 */
export const GASFREE_DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

/**
 * EIP-712 type definitions for PaymentPermit
 * Based on PermitHash.sol from the contract
 */
export const PAYMENT_PERMIT_TYPES = {
  PermitMeta: [
    { name: 'kind', type: 'uint8' },
    { name: 'paymentId', type: 'bytes16' },
    { name: 'nonce', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
  ],
  Payment: [
    { name: 'payToken', type: 'address' },
    { name: 'payAmount', type: 'uint256' },
    { name: 'payTo', type: 'address' },
  ],
  Fee: [
    { name: 'feeTo', type: 'address' },
    { name: 'feeAmount', type: 'uint256' },
  ],
  PaymentPermitDetails: [
    { name: 'meta', type: 'PermitMeta' },
    { name: 'buyer', type: 'address' },
    { name: 'caller', type: 'address' },
    { name: 'payment', type: 'Payment' },
    { name: 'fee', type: 'Fee' },
  ],
} as const;

/** Kind mapping for EIP-712 (string to numeric) */
export const KIND_MAP: Record<DeliveryKind, number> = {
  PAYMENT_ONLY: 0,
};

/** ERC20 ABI for allowance/approve calls */
export const ERC20_ABI = [
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * PaymentPermit contract ABI (subset used by facilitator settlement).
 *
 * Mirrors Python `bankofai.x402.abi.PAYMENT_PERMIT_ABI`. Only the methods
 * actually called by the facilitator are included; the on-chain contract
 * exposes more (DOMAIN_SEPARATOR, nonceBitmap, nonceUsed) that we surface
 * here in case TS callers need them too.
 */
export const PAYMENT_PERMIT_ABI = [
  {
    name: 'permitTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'permit',
        type: 'tuple',
        components: [
          {
            name: 'meta',
            type: 'tuple',
            components: [
              { name: 'kind', type: 'uint8' },
              { name: 'paymentId', type: 'bytes16' },
              { name: 'nonce', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
            ],
          },
          { name: 'buyer', type: 'address' },
          { name: 'caller', type: 'address' },
          {
            name: 'payment',
            type: 'tuple',
            components: [
              { name: 'payToken', type: 'address' },
              { name: 'payAmount', type: 'uint256' },
              { name: 'payTo', type: 'address' },
            ],
          },
          {
            name: 'fee',
            type: 'tuple',
            components: [
              { name: 'feeTo', type: 'address' },
              { name: 'feeAmount', type: 'uint256' },
            ],
          },
        ],
      },
      { name: 'owner', type: 'address' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'DOMAIN_SEPARATOR',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'nonceUsed',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'nonce', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * ERC-3009 `transferWithAuthorization` ABI (v, r, s variant).
 *
 * Mirrors Python `bankofai.x402.mechanisms._exact_base.types.TRANSFER_WITH_AUTHORIZATION_ABI`.
 * Used by `exact` scheme facilitator settle.
 */
export const TRANSFER_WITH_AUTHORIZATION_ABI = [
  {
    name: 'transferWithAuthorization',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'authorizationState',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
