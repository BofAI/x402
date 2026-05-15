/**
 * x402 TypeScript SDK
 * 
 * @packageDocumentation
 */

// Core
export * from './client/index.js';
export * from './types/index.js';
export * from './utils/index.js';
export * from './abi.js';
export * from './config.js';
export * from './errors.js';
export * from './tokens.js';
export * from './address.js';

// HTTP Client
export * from './http/client.js';

// Facilitator client (talks to remote /verify, /settle, /supported, /fee/quote)
export * from './facilitator/index.js';

// High-level server API (X402Server, ResourceConfig, ServerMechanism)
export * from './server/index.js';

// Server middleware (Hono / Express adapters + framework-agnostic core)
export * from './middleware/index.js';

// Mechanisms
export * from './mechanisms/index.js';

// EVM ExactPermit Mechanism
export * from './mechanisms/evm/exact_permit/index.js';

// TRON Signer
export * from './signers/signer.js';
// EVM Signer
export * from './signers/evmSigner.js';
export type { TronWeb, TypedDataDomain, TypedDataField, TronNetwork, TRON_CHAIN_IDS } from './signers/types.js';

// Facilitator signers (verify + writeContract + receipt polling)
export { FacilitatorSigner } from './signers/facilitator/base.js';
export type {
  FacilitatorTypedDataDomain,
  FacilitatorTypedDataTypes,
  FacilitatorTransactionReceipt,
} from './signers/index.js';
export { TronFacilitatorSigner } from './signers/facilitator/tronSigner.js';
export { EvmFacilitatorSigner } from './signers/facilitator/evmSigner.js';
