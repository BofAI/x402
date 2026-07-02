/**
 * Shared base for the `exact` scheme — mirrors Python
 * `bankofai.x402.mechanisms._exact_base`.
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

export type { ChainAdapter } from './adapter.js';
export { EvmChainAdapter } from './evmAdapter.js';
export { TronChainAdapter } from './tronAdapter.js';
export { ExactBaseServerMechanism } from './server.js';
export { ExactBaseFacilitatorMechanism } from './facilitator.js';
