import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { decodePaymentPayload, type PaymentRequired } from '@bankofai/x402';
import { cmdServer } from './server.js';

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

describe('cmdServer (validation)', () => {
  it('rejects --pay-to omitted', async () => {
    const code = await cmdServer({
      payTo: '',
      decimal: '1',
      network: 'tron:nile',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects --network omitted', async () => {
    const code = await cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      decimal: '1',
      network: '',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects when both --decimal and --amount are passed', async () => {
    const code = await cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      decimal: '1',
      amount: '1000000',
      network: 'tron:nile',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects when neither --decimal nor --amount is given', async () => {
    const code = await cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      network: 'tron:nile',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_AMOUNT');
  });
});

describe('cmdServer (live HTTP probe)', () => {
  it('binds, exposes /health + /.well-known/x402, and 402s on /pay', async () => {
    const port = 4400 + Math.floor(Math.random() * 100);
    const startPromise = cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      decimal: '1.25',
      network: 'tron:nile',
      token: 'USDT',
      port,
      output: 'json',
    });
    await new Promise((r) => setTimeout(r, 100));
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const terms = await fetch(`http://127.0.0.1:${port}/.well-known/x402`);
      expect(terms.status).toBe(200);
      const body = (await terms.json()) as Record<string, unknown>;
      expect(body.network).toBe('tron:nile');
      expect(body.token).toBe('USDT');
      expect(body.decimal).toBe('1.25');
      expect(body.amount).toBe('1250000');
      expect(body.pay_url).toBe(`http://127.0.0.1:${port}/pay`);
      expect(body.resource_url).toBe(`http://127.0.0.1:${port}/pay`);

      const probe = await fetch(`http://127.0.0.1:${port}/pay`);
      expect(probe.status).toBe(402);
      expect(probe.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    } finally {
      process.emit('SIGTERM');
      await startPromise;
    }
  }, 10_000);

  it('issues a fresh exact_permit nonce for every /pay challenge', async () => {
    const port = 4500 + Math.floor(Math.random() * 100);
    const previousOverride = process.env.X402_FACILITATOR_URL_OVERRIDE;
    process.env.X402_FACILITATOR_URL_OVERRIDE = 'http://127.0.0.1:9';
    const startPromise = cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      decimal: '0.0001',
      network: 'tron:nile',
      token: 'USDT',
      scheme: 'exact_permit',
      port,
      output: 'json',
    });
    await new Promise((r) => setTimeout(r, 100));
    try {
      const first = await fetch(`http://127.0.0.1:${port}/pay`);
      const second = await fetch(`http://127.0.0.1:${port}/pay`);
      const firstChallenge = decodePaymentPayload<PaymentRequired>(
        first.headers.get('PAYMENT-REQUIRED')!,
      );
      const secondChallenge = decodePaymentPayload<PaymentRequired>(
        second.headers.get('PAYMENT-REQUIRED')!,
      );
      const firstNonce = firstChallenge.extensions?.paymentPermitContext?.meta?.nonce;
      const secondNonce = secondChallenge.extensions?.paymentPermitContext?.meta?.nonce;

      expect(first.status).toBe(402);
      expect(second.status).toBe(402);
      expect(firstNonce).toMatch(/^[0-9]+$/);
      expect(secondNonce).toMatch(/^[0-9]+$/);
      expect(firstNonce).not.toBe('0');
      expect(secondNonce).not.toBe(firstNonce);
    } finally {
      if (previousOverride === undefined) {
        delete process.env.X402_FACILITATOR_URL_OVERRIDE;
      } else {
        process.env.X402_FACILITATOR_URL_OVERRIDE = previousOverride;
      }
      process.emit('SIGTERM');
      await startPromise;
    }
  }, 10_000);
});
