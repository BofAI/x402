/**
 * Mechanism registry — public API.
 *
 * Layout mirrors Python `bankofai.x402.mechanisms` (per-chain subdirs, with
 * `_base` / `_exact_base` / `_exact_permit_base` holding shared logic).
 *
 * Top-level re-exports preserved for back-compat with existing consumers.
 */

// === Per-(chain, scheme) client mechanisms ===
export { ExactEvmClientMechanism } from './evm/exact/index.js';
export { ExactPermitEvmClientMechanism } from './evm/exact_permit/index.js';
export { ExactTronClientMechanism } from './tron/exact/index.js';
export { ExactPermitTronClientMechanism } from './tron/exact_permit/index.js';
export { ExactGasFreeClientMechanism } from './tron/exact_gasfree/index.js';

// === Shared exact-scheme primitives (EIP-712 / TIP-712 typed-data) ===
export {
  DEFAULT_VALIDITY_SECONDS,
  SCHEME_EXACT,
  TRANSFER_AUTH_EIP712_TYPES,
  TRANSFER_AUTH_PRIMARY_TYPE,
  buildEip712Domain,
  buildEip712Message,
  createNonce,
  createValidityWindow,
} from './_exact_base/index.js';
export type { TransferAuthorization } from './_exact_base/index.js';

// === Role interface re-exports (single canonical mechanism-rooted path) ===
export type {
  ClientMechanism,
  ClientSigner,
  ServerMechanism,
  FacilitatorMechanism,
  FacilitatorLogger,
} from './_base/index.js';
