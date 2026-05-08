/**
 * Facilitator surface for the x402 payment protocol.
 *
 * - {@link FacilitatorClient} — talks to a remote facilitator (used by server middleware)
 * - {@link X402Facilitator} — in-process payment processor (the engine of a facilitator service)
 *
 * Re-exported via the package root so consumers can `import { FacilitatorClient,
 * X402Facilitator } from '@bankofai/x402'`.
 */

export { FacilitatorClient } from './client.js';
export type { FacilitatorClientConfig, FeeQuoteContext } from './client.js';
export { X402Facilitator } from './x402Facilitator.js';
export type { FacilitatorMechanism, FacilitatorLogger } from './x402Facilitator.js';
