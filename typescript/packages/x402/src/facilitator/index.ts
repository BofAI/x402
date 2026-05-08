/**
 * Facilitator client for the x402 payment protocol.
 *
 * Re-exports {@link FacilitatorClient} and its config type so consumers can
 * import from `@bankofai/x402/facilitator` (or via the package root re-export).
 */

export { FacilitatorClient } from './client.js';
export type { FacilitatorClientConfig, FeeQuoteContext } from './client.js';
