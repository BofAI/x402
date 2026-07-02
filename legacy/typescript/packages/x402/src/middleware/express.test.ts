/**
 * Integration tests for the Express adapter.
 *
 * Drives the middleware via a fake (Request, Response, next) pair so we don't
 * need a real listening server.
 */

import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { FacilitatorClient } from '../facilitator/client.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from '../http/client.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import { decodePaymentPayload, encodePaymentPayload } from '../utils/encoding.js';
import { x402Express } from './express.js';

const REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};

function fakeFacilitator(
  verify: VerifyResponse,
  settle: SettleResponse,
): FacilitatorClient {
  const fetchImpl: typeof fetch = vi.fn(async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.endsWith('/verify')) return new Response(JSON.stringify(verify), { status: 200 });
    if (url.endsWith('/settle')) return new Response(JSON.stringify(settle), { status: 200 });
    return new Response('nf', { status: 404 });
  }) as unknown as typeof fetch;
  return new FacilitatorClient({ baseUrl: 'https://fac.test', fetchImpl });
}

interface FakeResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  nextCalled: boolean;
}

/** Pure-JS stub that records what the middleware did. */
function makeReqRes(headers: Record<string, string> = {}): {
  req: Request;
  res: Response;
  next: NextFunction;
  result: FakeResult;
} {
  const result: FakeResult = { status: 0, body: undefined, headers: {}, nextCalled: false };
  const req = {
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  } as unknown as Request;
  const res = {
    setHeader: vi.fn((k: string, v: string) => {
      result.headers[k] = v;
    }),
    status: vi.fn((code: number) => {
      result.status = code;
      return res;
    }),
    json: vi.fn((b: unknown) => {
      result.body = b;
      if (result.status === 0) result.status = 200;
      return res;
    }),
  } as unknown as Response;
  const next: NextFunction = vi.fn(() => {
    result.nextCalled = true;
  });
  return { req, res, next, result };
}

describe('x402Express integration', () => {
  it('returns 402 + PAYMENT-REQUIRED when no signature', async () => {
    const handler = x402Express({
      facilitator: fakeFacilitator({ isValid: true }, { success: true }),
      accepts: [REQ],
    });
    const { req, res, next, result } = makeReqRes();

    await handler(req, res, next);

    expect(result.status).toBe(402);
    expect(result.nextCalled).toBe(false);
    expect(result.headers[PAYMENT_REQUIRED_HEADER]).toBeTruthy();
    expect((result.body as { accepts: unknown }).accepts).toEqual([REQ]);
  });

  it('calls next() + attaches PAYMENT-RESPONSE on valid payment', async () => {
    const settled: SettleResponse = {
      success: true,
      transaction: '0xabc',
      network: 'tron:nile',
    };
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: REQ,
      payload: { signature: '0x' + 'aa'.repeat(65) },
    };
    const handler = x402Express({
      facilitator: fakeFacilitator({ isValid: true }, settled),
      accepts: [REQ],
    });
    const { req, res, next, result } = makeReqRes({
      [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(payload),
    });

    await handler(req, res, next);

    expect(result.nextCalled).toBe(true);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBeTruthy();
    expect(
      decodePaymentPayload<SettleResponse>(result.headers[PAYMENT_RESPONSE_HEADER]!),
    ).toEqual(settled);
    expect(result.status).toBe(0); // handler not invoked, status not set
  });

  it('returns 400 on malformed signature', async () => {
    const handler = x402Express({
      facilitator: fakeFacilitator({ isValid: true }, { success: true }),
      accepts: [REQ],
    });
    const { req, res, next, result } = makeReqRes({
      [PAYMENT_SIGNATURE_HEADER]: 'not-base64-json',
    });

    await handler(req, res, next);

    expect(result.status).toBe(400);
    expect(result.nextCalled).toBe(false);
    expect((result.body as { error: string }).error).toMatch(/Invalid payment payload/);
  });

  it('returns 500 with txHash + network on settle failure', async () => {
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: REQ,
      payload: { signature: '0x' + 'aa'.repeat(65) },
    };
    const handler = x402Express({
      facilitator: fakeFacilitator(
        { isValid: true },
        {
          success: false,
          errorReason: 'insufficient',
          transaction: '0xabc',
          network: 'tron:nile',
        },
      ),
      accepts: [REQ],
    });
    const { req, res, next, result } = makeReqRes({
      [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(payload),
    });

    await handler(req, res, next);

    expect(result.status).toBe(500);
    expect(result.nextCalled).toBe(false);
    const body = result.body as Record<string, unknown>;
    expect(body.error).toBe('insufficient');
    expect(body.txHash).toBe('0xabc');
    expect(body.network).toBe('tron:nile');
  });
});
