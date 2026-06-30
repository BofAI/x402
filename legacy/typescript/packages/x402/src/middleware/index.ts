/**
 * x402 server middleware.
 *
 * - {@link x402Hono} — Hono adapter
 * - {@link x402Express} — Express adapter
 * - {@link processX402Request} — framework-agnostic core (build your own adapter)
 */

export { processX402Request, X402_VERSION } from './core.js';
export type { X402Decision, X402MiddlewareConfig } from './core.js';
export { x402Hono } from './hono.js';
export { x402Express } from './express.js';
