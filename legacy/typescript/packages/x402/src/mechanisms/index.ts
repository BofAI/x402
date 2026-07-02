/**
 * Mechanism registry — public API.
 *
 * Layout mirrors Python `bankofai.x402.mechanisms` (per-chain subdirs, with
 * `_base` / `_exact_base` / `_exact_permit_base` holding shared logic).
 */

// === Per-(chain, scheme) client mechanisms ===
export { ExactEvmClientMechanism } from './evm/exact/index.js';
export { ExactPermitEvmClientMechanism } from './evm/exact_permit/index.js';
export { ExactTronClientMechanism } from './tron/exact/index.js';
export { ExactPermitTronClientMechanism } from './tron/exact_permit/index.js';
export { ExactGasFreeClientMechanism } from './tron/exact_gasfree/index.js';

// === Per-(chain, scheme) server mechanisms ===
export { ExactEvmServerMechanism } from './evm/exact/index.js';
export { ExactPermitEvmServerMechanism } from './evm/exact_permit/index.js';
export { ExactTronServerMechanism } from './tron/exact/index.js';
export { ExactPermitTronServerMechanism } from './tron/exact_permit/index.js';
export { ExactGasFreeServerMechanism } from './tron/exact_gasfree/index.js';

// === Per-(chain, scheme) facilitator mechanisms ===
export { ExactEvmFacilitatorMechanism } from './evm/exact/index.js';
export { ExactPermitEvmFacilitatorMechanism } from './evm/exact_permit/index.js';
export { ExactTronFacilitatorMechanism } from './tron/exact/index.js';
export { ExactPermitTronFacilitatorMechanism } from './tron/exact_permit/index.js';
export { ExactGasFreeFacilitatorMechanism } from './tron/exact_gasfree/index.js';
export type { ExactGasFreeFacilitatorOptions } from './tron/exact_gasfree/index.js';

// === Shared base classes (for users wanting to subclass) ===
export {
  ExactBaseServerMechanism,
  ExactBaseFacilitatorMechanism,
  EvmChainAdapter,
  TronChainAdapter,
} from './_exact_base/index.js';
export type { ChainAdapter } from './_exact_base/index.js';
export {
  BaseExactPermitServerMechanism,
  BaseExactPermitFacilitatorMechanism,
} from './_exact_permit_base/index.js';
export type { BaseExactPermitFee } from './_exact_permit_base/index.js';

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

// === Role interface re-exports ===
export type {
  ClientMechanism,
  ClientSigner,
  ServerMechanism,
  FacilitatorMechanism,
  FacilitatorLogger,
} from './_base/index.js';
