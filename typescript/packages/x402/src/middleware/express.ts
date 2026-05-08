/**
 * Express adapter for the x402 server middleware.
 *
 * Usage:
 * ```ts
 * import express from 'express';
 * import { FacilitatorClient, x402Express } from '@bankofai/x402';
 *
 * const facilitator = new FacilitatorClient({ baseUrl: 'https://facilitator.example' });
 * const app = express();
 *
 * app.use(
 *   '/api/llm-summary',
 *   x402Express({
 *     facilitator,
 *     accepts: [{
 *       scheme: 'exact_permit',
 *       network: 'eip155:97',
 *       amount: '1000000',
 *       asset: '0x...',
 *       payTo: '0x...',
 *     }],
 *   }),
 * );
 *
 * app.get('/api/llm-summary', (req, res) => res.json({ summary: '...' }));
 * ```
 *
 * Express is imported via `peerDependencies`; consumers add it to their app.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  PAYMENT_SIGNATURE_HEADER,
  processX402Request,
  type X402MiddlewareConfig,
} from './core.js';

/**
 * Build an Express request handler that gates the route on x402 payment.
 *
 * Behavior matches the Hono adapter — see {@link X402MiddlewareConfig} and
 * {@link processX402Request} for the underlying decision logic.
 */
export function x402Express(config: X402MiddlewareConfig): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const signature = readHeader(req, PAYMENT_SIGNATURE_HEADER);
    let decision;
    try {
      decision = await processX402Request(signature, config);
    } catch (err) {
      next(err);
      return;
    }

    switch (decision.kind) {
      case 'paymentRequired':
        for (const [k, v] of Object.entries(decision.headers)) {
          res.setHeader(k, v);
        }
        res.status(402).json(decision.paymentRequired);
        return;
      case 'invalid':
        res.status(400).json({ error: decision.reason });
        return;
      case 'failed': {
        const body: Record<string, unknown> = { error: decision.reason };
        if (decision.transaction) body.txHash = decision.transaction;
        if (decision.network) body.network = decision.network;
        res.status(500).json(body);
        return;
      }
      case 'allow':
        for (const [k, v] of Object.entries(decision.headers)) {
          res.setHeader(k, v);
        }
        next();
        return;
    }
  };
}

function readHeader(req: Request, name: string): string | null {
  const raw = req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}
