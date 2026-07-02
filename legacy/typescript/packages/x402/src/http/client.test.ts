/**
 * Tests for X402FetchClient — automatic 402 challenge-retry on the client side.
 *
 * Uses a fake fetch impl + a stub X402Client.handlePayment so the suite stays
 * hermetic.
 */

import { describe, expect, it, vi } from 'vitest';

import type { X402Client } from '../client/index.js';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from '../types/index.js';
import { encodePaymentPayload } from '../utils/encoding.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  X402FetchClient,
  parsePaymentResponseHeader,
} from './client.js';

const REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};

const PAYMENT_REQUIRED: PaymentRequired = {
  x402Version: 2,
  accepts: [REQ],
};

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: REQ,
  payload: { signature: '0x' + 'aa'.repeat(65) },
};

function makeStubX402Client(payload: PaymentPayload = PAYLOAD): X402Client {
  return {
    handlePayment: vi.fn(async () => payload),
  } as unknown as X402Client;
}

interface ScriptedFetchCall {
  url: string;
  init?: RequestInit;
}

function scriptedFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: ScriptedFetchCall[];
} {
  const calls: ScriptedFetchCall[] = [];
  let i = 0;
  const fetchImpl: typeof fetch = vi.fn(async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push({ url, init });
    const next = responses[i++];
    if (!next) throw new Error(`scriptedFetch: no more queued responses (call #${i})`);
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('X402FetchClient', () => {
  it('passes through non-402 responses unchanged', async () => {
    const ok = new Response('hello', { status: 200 });
    const { fetchImpl, calls } = scriptedFetch([ok]);
    const client = new X402FetchClient(makeStubX402Client(), { fetchImpl });

    const res = await client.get('https://example.com/api');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init?.method).toBe('GET');
  });

  it('handles 402 → sign → retry happy path', async () => {
    const challenge = new Response(JSON.stringify(PAYMENT_REQUIRED), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        [PAYMENT_REQUIRED_HEADER]: encodePaymentPayload(PAYMENT_REQUIRED),
      },
    });
    const settled: SettleResponse = {
      success: true,
      transaction: '0xabc',
      network: 'tron:nile',
    };
    const success = new Response('paid', {
      status: 200,
      headers: { [PAYMENT_RESPONSE_HEADER]: encodePaymentPayload(settled) },
    });
    const { fetchImpl, calls } = scriptedFetch([challenge, success]);
    const x402 = makeStubX402Client();
    const client = new X402FetchClient(x402, { fetchImpl });

    const res = await client.get('https://example.com/api');

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    // Retry carried PAYMENT-SIGNATURE header.
    const retryHeaders = calls[1]!.init?.headers as Headers;
    expect(retryHeaders.get(PAYMENT_SIGNATURE_HEADER)).toBe(encodePaymentPayload(PAYLOAD));
    expect(x402.handlePayment).toHaveBeenCalledWith(
      PAYMENT_REQUIRED.accepts,
      'https://example.com/api',
      undefined,
      undefined,
    );
    // PAYMENT-RESPONSE round-trips back through the helper.
    expect(parsePaymentResponseHeader(res)).toEqual(settled);
  });

  it('falls back to body-parsing when PAYMENT-REQUIRED header is missing', async () => {
    const challenge = new Response(JSON.stringify(PAYMENT_REQUIRED), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });
    const success = new Response('paid', { status: 200 });
    const { fetchImpl } = scriptedFetch([challenge, success]);
    const client = new X402FetchClient(makeStubX402Client(), { fetchImpl });

    const res = await client.get('https://example.com/api');
    expect(res.status).toBe(200);
  });

  it('returns the original 402 when no PaymentRequired can be parsed', async () => {
    const broken = new Response('not json', {
      status: 402,
      headers: { 'Content-Type': 'text/plain' },
    });
    const { fetchImpl, calls } = scriptedFetch([broken]);
    const client = new X402FetchClient(makeStubX402Client(), { fetchImpl });

    const res = await client.get('https://example.com/api');
    expect(res.status).toBe(402);
    expect(calls).toHaveLength(1);
  });

  it('forwards method-specific shorthands correctly', async () => {
    const ok = () => new Response('', { status: 200 });
    const { fetchImpl, calls } = scriptedFetch([ok(), ok(), ok(), ok(), ok()]);
    const client = new X402FetchClient(makeStubX402Client(), { fetchImpl });

    await client.get('https://e.com/g');
    await client.post('https://e.com/p', 'body1');
    await client.put('https://e.com/u', 'body2');
    await client.patch('https://e.com/h', 'body3');
    await client.delete('https://e.com/d');

    expect(calls.map((c) => c.init?.method)).toEqual([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
    ]);
    expect(calls[1]!.init?.body).toBe('body1');
    expect(calls[2]!.init?.body).toBe('body2');
    expect(calls[3]!.init?.body).toBe('body3');
  });

  it('parsePaymentResponseHeader returns null for missing / malformed headers', () => {
    const noHeader = new Response('', { status: 200 });
    expect(parsePaymentResponseHeader(noHeader)).toBeNull();

    const badHeader = new Response('', {
      status: 200,
      headers: { [PAYMENT_RESPONSE_HEADER]: 'not-base64-json' },
    });
    expect(parsePaymentResponseHeader(badHeader)).toBeNull();
  });

  it('legacy positional selector argument is accepted (back-compat surface)', () => {
    // Construction with a positional selector keeps the pre-options surface alive.
    // Behaviour-wise the legacy path falls back to global fetch (no fetchImpl
    // injection slot) — the surface preserved here is the type-level contract.
    const selector = vi.fn();
    expect(() => new X402FetchClient(makeStubX402Client(), selector)).not.toThrow();
  });
});
