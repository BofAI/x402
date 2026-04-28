import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cmdClient } from './client.js';
import { encodePaymentPayload } from '@bankofai/x402';

let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  vi.restoreAllMocks();
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

describe('cmdClient (validation)', () => {
  it('rejects an empty URL', async () => {
    const code = await cmdClient({ url: '', output: 'json' });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects --max-decimal and --max-amount together', async () => {
    const code = await cmdClient({
      url: 'http://127.0.0.1:0/pay',
      maxDecimal: '1',
      maxAmount: '1000000',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('cmdClient (non-402)', () => {
  it('returns a non-402 summary without signing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, hello: 'world' }), { status: 200 }) as unknown as Response,
    );
    const code = await cmdClient({ url: 'http://127.0.0.1:0/x', output: 'json' });
    expect(code).toBe(0);
    const env = lastJson<{ result: { status: number; note: string; body: unknown } }>();
    expect(env.result.status).toBe(200);
    expect(env.result.note).toMatch(/402 not returned/);
  });
});

describe('cmdClient (--dry-run)', () => {
  it('reports the chosen requirement when 402 is returned', async () => {
    const accepts = [
      {
        scheme: 'exact_permit',
        network: 'eip155:97',
        amount: '1000000000000000000',
        asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
        payTo: '0x6d361463Ad6Df90bC34aF65f4970d3271aa83535',
        maxTimeoutSeconds: 180,
        extra: { name: 'Tether USD', version: '1' },
      },
    ];
    const required = { x402Version: 2, accepts };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(required), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentPayload(required) },
      }) as unknown as Response,
    );
    const code = await cmdClient({
      url: 'http://127.0.0.1:0/pay',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{
      result: {
        status: number;
        accepts: Array<{ scheme: string }>;
        chosen: { scheme: string; network: string };
      };
    }>();
    expect(env.result.status).toBe(402);
    expect(env.result.accepts).toHaveLength(1);
    expect(env.result.chosen.scheme).toBe('exact_permit');
    expect(env.result.chosen.network).toBe('eip155:97');
  });

  it('rejects when --max-amount is below the server quote', async () => {
    const accepts = [
      {
        scheme: 'exact_permit',
        network: 'eip155:97',
        amount: '1000000000000000000',
        asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
        payTo: '0x6d361463Ad6Df90bC34aF65f4970d3271aa83535',
      },
    ];
    const required = { x402Version: 2, accepts };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(required), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentPayload(required) },
      }) as unknown as Response,
    );
    const code = await cmdClient({
      url: 'http://127.0.0.1:0/pay',
      maxAmount: '1',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('PAYMENT_CANCELLED');
  });

  it('rejects when --network does not match server', async () => {
    const accepts = [
      {
        scheme: 'exact_permit',
        network: 'eip155:97',
        amount: '1000000000000000000',
        asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
        payTo: '0x6d361463Ad6Df90bC34aF65f4970d3271aa83535',
      },
    ];
    const required = { x402Version: 2, accepts };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(required), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentPayload(required) },
      }) as unknown as Response,
    );
    const code = await cmdClient({
      url: 'http://127.0.0.1:0/pay',
      network: 'tron:nile',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('PAYMENT_CANCELLED');
  });

  it('passes --token USDT against a Nile USDT server (resolves via registry)', async () => {
    const accepts = [
      {
        scheme: 'exact_gasfree',
        network: 'tron:nile',
        amount: '10000',
        asset: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
        extra: { name: 'Tether USD', version: '1' },
      },
    ];
    const required = { x402Version: 2, accepts };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(required), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentPayload(required) },
      }) as unknown as Response,
    );
    const code = await cmdClient({
      url: 'http://127.0.0.1:0/pay',
      token: 'USDT',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { chosen: { network: string } } }>();
    expect(env.result.chosen.network).toBe('tron:nile');
  });
});
