/**
 * Shared base for the `exact` scheme — mirrors Python
 * `bankofai.x402.mechanisms._exact_base`.
 *
 * Types and EIP-712 / TIP-712 typed-data helpers live in `./types.ts`.
 * Future shared client / server / facilitator base classes (ChainAdapter
 * pattern, like Python's `_exact_base.base.ExactBaseServerMechanism` etc.)
 * will be added here.
 */

export {
  DEFAULT_VALIDITY_SECONDS,
  SCHEME_EXACT,
  TRANSFER_AUTH_EIP712_TYPES,
  TRANSFER_AUTH_PRIMARY_TYPE,
  buildEip712Domain,
  buildEip712Message,
  createNonce,
  createValidityWindow,
} from './types.js';
export type { TransferAuthorization } from './types.js';
