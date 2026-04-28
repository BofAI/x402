import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('rejects when both --decimal and --raw-amount are passed', async () => {
    const code = await cmdServer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      decimal: '1',
      rawAmount: '1000000',
      network: 'tron:nile',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_AMOUNT');
  });

  it('rejects when neither --decimal nor --raw-amount is given', async () => {
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
      expect(body.raw_amount).toBe('1250000');
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
});
