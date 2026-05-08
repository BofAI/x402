/**
 * Tests for FacilitatorClient.
 *
 * Uses a fake fetch impl so the suite stays hermetic — no live HTTP, no servers.
 */

import { describe, expect, it, vi } from 'vitest';

import { FacilitatorError } from '../errors.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '../types/index.js';
import { FacilitatorClient } from './client.js';

/** Build a fake fetch that returns a single canned response and records the call. */
function mockFetch(json: unknown, status = 200): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    calls.push({
      url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      init,
    });
    return new Response(JSON.stringify(json), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const REQUIREMENTS: PaymentRequirements = {
  scheme: 'exact',
  network: 'tron:nile',
  maxAmountRequired: '1000000',
  resource: 'http://example.com/api',
  description: 'test',
  mimeType: 'application/json',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
  maxTimeoutSeconds: 60,
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  amount: '1000000',
};

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: REQUIREMENTS,
  payload: { signature: '0x' + 'aa'.repeat(65) },
};

describe('FacilitatorClient', () => {
  it('strips trailing slashes from baseUrl', () => {
    const client = new FacilitatorClient({
      baseUrl: 'https://facilitator.example/',
      fetchImpl: mockFetch({}).fetchImpl,
    });
    expect(client.facilitatorId).toBe('https://facilitator.example');
  });

  it('uses explicit facilitatorId when provided', () => {
    const client = new FacilitatorClient({
      baseUrl: 'https://facilitator.example',
      facilitatorId: 'fac-1',
      fetchImpl: mockFetch({}).fetchImpl,
    });
    expect(client.facilitatorId).toBe('fac-1');
  });

  it('GETs /supported and parses the response', async () => {
    const supported: SupportedResponse = {
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'tron:nile' }],
    };
    const { fetchImpl, calls } = mockFetch(supported);
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    const result = await client.supported();

    expect(result).toEqual(supported);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://fac.example/supported');
    expect(calls[0]!.init?.method).toBe('GET');
  });

  it('POSTs /verify with snake_camelCase payload + requirements wire fields', async () => {
    const verify: VerifyResponse = { isValid: true };
    const { fetchImpl, calls } = mockFetch(verify);
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    const result = await client.verify(PAYLOAD, REQUIREMENTS);

    expect(result).toEqual(verify);
    expect(calls[0]!.url).toBe('https://fac.example/verify');
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.paymentPayload).toEqual(PAYLOAD);
    expect(body.paymentRequirements).toEqual(REQUIREMENTS);
  });

  it('POSTs /settle with the same wire shape', async () => {
    const settle: SettleResponse = {
      success: true,
      transaction: '0xdeadbeef',
      network: 'tron:nile',
    };
    const { fetchImpl, calls } = mockFetch(settle);
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    const result = await client.settle(PAYLOAD, REQUIREMENTS);

    expect(result).toEqual(settle);
    expect(calls[0]!.url).toBe('https://fac.example/settle');
  });

  it('POSTs /fee/quote with optional context', async () => {
    const quotes: FeeQuoteResponse[] = [
      {
        fee: { feeTo: '0xabc', feeAmount: '0' },
        pricing: 'fixed',
        scheme: 'exact',
        network: 'tron:nile',
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      },
    ];
    const { fetchImpl, calls } = mockFetch(quotes);
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    await client.feeQuote([REQUIREMENTS], { paymentId: '0x' + '11'.repeat(16) });

    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.accepts).toHaveLength(1);
    expect(body.paymentPermitContext).toEqual({ paymentId: '0x' + '11'.repeat(16) });
  });

  it('omits paymentPermitContext when no context given', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    await client.feeQuote([REQUIREMENTS]);

    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body).not.toHaveProperty('paymentPermitContext');
  });

  it('forwards custom headers on every request', async () => {
    const { fetchImpl, calls } = mockFetch({ kinds: [] });
    const client = new FacilitatorClient({
      baseUrl: 'https://fac.example',
      headers: { Authorization: 'Bearer abc' },
      fetchImpl,
    });

    await client.supported();

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
  });

  it('throws FacilitatorError on non-2xx with body preserved', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    await expect(client.verify(PAYLOAD, REQUIREMENTS)).rejects.toMatchObject({
      name: 'FacilitatorError',
      status: 500,
      body: 'boom',
    });
  });

  it('throws FacilitatorError on transport failure', async () => {
    const fetchImpl: typeof fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = new FacilitatorClient({ baseUrl: 'https://fac.example', fetchImpl });

    const promise = client.supported();
    await expect(promise).rejects.toBeInstanceOf(FacilitatorError);
    await expect(promise).rejects.toMatchObject({ status: 0 });
  });

  it('close() is a no-op safe to call', async () => {
    const client = new FacilitatorClient({
      baseUrl: 'https://fac.example',
      fetchImpl: mockFetch({}).fetchImpl,
    });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
