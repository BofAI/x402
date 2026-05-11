/**
 * Integration tests for the Hono adapter — proves FacilitatorClient + middleware
 * core + Hono adapter compose correctly through the wire.
 */

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { FacilitatorClient } from '../facilitator/client.js';
import { PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, PAYMENT_SIGNATURE_HEADER } from '../http/client.js';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import { decodePaymentPayload, encodePaymentPayload } from '../utils/encoding.js';
import { x402Hono } from './hono.js';

const REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};

/** Build a FacilitatorClient whose fetch returns canned verify/settle bodies. */
function fakeFacilitator(verify: VerifyResponse, settle: SettleResponse): FacilitatorClient {
  const fetchImpl: typeof fetch = vi.fn(async (input) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (url.endsWith('/verify')) {
      return new Response(JSON.stringify(verify), { status: 200 });
    }
    if (url.endsWith('/settle')) {
      return new Response(JSON.stringify(settle), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return new FacilitatorClient({ baseUrl: 'https://fac.test', fetchImpl });
}

function buildPayload(req: PaymentRequirements = REQ): PaymentPayload {
  return {
    x402Version: 2,
    accepted: req,
    payload: { signature: '0x' + 'aa'.repeat(65) },
  };
}

describe('x402Hono integration', () => {
  it('returns 402 with PAYMENT-REQUIRED on bare request', async () => {
    const app = new Hono();
    app.use(
      '/api/data',
      x402Hono({
        facilitator: fakeFacilitator({ isValid: true }, { success: true }),
        accepts: [REQ],
      }),
    );
    app.get('/api/data', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/api/data');

    expect(res.status).toBe(402);
    const headerValue = res.headers.get(PAYMENT_REQUIRED_HEADER);
    expect(headerValue).toBeTruthy();
    const decoded = decodePaymentPayload<PaymentRequired>(headerValue!);
    expect(decoded.accepts).toEqual([REQ]);
  });

  it('serves the protected route on valid PAYMENT-SIGNATURE + attaches PAYMENT-RESPONSE', async () => {
    const settled: SettleResponse = {
      success: true,
      transaction: '0xabc',
      network: 'tron:nile',
    };
    const app = new Hono();
    app.use(
      '/api/data',
      x402Hono({
        facilitator: fakeFacilitator({ isValid: true }, settled),
        accepts: [REQ],
      }),
    );
    app.get('/api/data', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/api/data', {
      headers: { [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(buildPayload()) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: string };
    expect(body.data).toBe('secret');
    const settleHeader = res.headers.get(PAYMENT_RESPONSE_HEADER);
    expect(settleHeader).toBeTruthy();
    expect(decodePaymentPayload<SettleResponse>(settleHeader!)).toEqual(settled);
  });

  it('returns 400 when PAYMENT-SIGNATURE is malformed', async () => {
    const app = new Hono();
    app.use(
      '/api/data',
      x402Hono({
        facilitator: fakeFacilitator({ isValid: true }, { success: true }),
        accepts: [REQ],
      }),
    );
    app.get('/api/data', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/api/data', {
      headers: { [PAYMENT_SIGNATURE_HEADER]: 'not-base64-json' },
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid payment payload/);
  });

  it('returns 500 when verify rejects', async () => {
    const app = new Hono();
    app.use(
      '/api/data',
      x402Hono({
        facilitator: fakeFacilitator(
          { isValid: false, invalidReason: 'bad sig' },
          { success: true },
        ),
        accepts: [REQ],
      }),
    );
    app.get('/api/data', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/api/data', {
      headers: { [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(buildPayload()) },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('bad sig');
  });

  it('returns 500 with txHash + network when settle fails', async () => {
    const app = new Hono();
    app.use(
      '/api/data',
      x402Hono({
        facilitator: fakeFacilitator(
          { isValid: true },
          {
            success: false,
            errorReason: 'insufficient balance',
            transaction: '0xabc',
            network: 'tron:nile',
          },
        ),
        accepts: [REQ],
      }),
    );
    app.get('/api/data', (c) => c.json({ data: 'secret' }));

    const res = await app.request('/api/data', {
      headers: { [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(buildPayload()) },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('insufficient balance');
    expect(body.txHash).toBe('0xabc');
    expect(body.network).toBe('tron:nile');
  });
});
