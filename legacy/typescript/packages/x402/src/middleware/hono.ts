/**
 * Hono adapter for the x402 server middleware.
 *
 * Usage:
 * ```ts
 * import { Hono } from 'hono';
 * import { FacilitatorClient, x402Hono } from '@bankofai/x402';
 *
 * const facilitator = new FacilitatorClient({ baseUrl: 'https://facilitator.example' });
 * const app = new Hono();
 *
 * app.use(
 *   '/api/llm-summary',
 *   x402Hono({
 *     facilitator,
 *     accepts: [{
 *       scheme: 'exact_permit',
 *       network: 'tron:nile',
 *       amount: '1000000',
 *       asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
 *       payTo: 'TJWdoJ...',
 *     }],
 *   }),
 * );
 *
 * app.get('/api/llm-summary', (c) => c.json({ summary: '...' }));
 * ```
 *
 * Hono is imported via `peerDependencies`; consumers add it to their app.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';

import {
  PAYMENT_SIGNATURE_HEADER,
  processX402Request,
  type X402MiddlewareConfig,
} from './core.js';

/**
 * Build a Hono middleware that gates the wrapped route on x402 payment.
 *
 * Behavior:
 * - No `PAYMENT-SIGNATURE` header → respond 402 with `PAYMENT-REQUIRED` header + body.
 * - Malformed / mismatched payload → 400 JSON error.
 * - Verify or settle failure → 500 JSON error.
 * - Success → call `next()` and attach `PAYMENT-RESPONSE` header to the response.
 */
export function x402Hono(config: X402MiddlewareConfig): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const signature = c.req.header(PAYMENT_SIGNATURE_HEADER);
    const decision = await processX402Request(signature, config);

    switch (decision.kind) {
      case 'paymentRequired': {
        for (const [k, v] of Object.entries(decision.headers)) {
          c.header(k, v);
        }
        return c.json(decision.paymentRequired, 402);
      }
      case 'invalid':
        return c.json({ error: decision.reason }, 400);
      case 'failed': {
        const body: Record<string, unknown> = { error: decision.reason };
        if (decision.transaction) body.txHash = decision.transaction;
        if (decision.network) body.network = decision.network;
        return c.json(body, 500);
      }
      case 'allow': {
        await next();
        for (const [k, v] of Object.entries(decision.headers)) {
          c.header(k, v);
        }
        return;
      }
    }
  };
}
