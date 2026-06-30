/**
 * High-level x402 server API.
 *
 * For framework-agnostic protocol handling, see also `src/middleware/core.ts`.
 * {@link X402Server} sits above that — it owns mechanism registration, price
 * parsing, anti-tamper validation, and facilitator coordination.
 */

export { DefaultServerMechanism, X402Server } from './x402Server.js';
export type { BuildPaymentRequiredOptions } from './x402Server.js';
export { PAYMENT_ONLY } from './types.js';
export type { ResourceConfig, ServerMechanism } from './types.js';
