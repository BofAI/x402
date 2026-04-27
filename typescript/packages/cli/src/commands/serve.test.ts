import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdServeTransfer } from './serve.js';
import { cmdInit } from './config.js';

let tmpDir: string;
let cfgPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-serve-'));
  cfgPath = path.join(tmpDir, 'config.json');
  process.env.X402_CONFIG_FILE = cfgPath;
  process.env.X402_RECEIPT_FILE = path.join(tmpDir, 'receipts.jsonl');
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  delete process.env.X402_RECEIPT_FILE;
  stdoutSpy.mockRestore();
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

describe('cmdServeTransfer (validation)', () => {
  it('rejects --pay-to omitted', async () => {
    const code = await cmdServeTransfer({
      payTo: '',
      amount: '0.001',
      token: 'USDT',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects EVM networks for the MVP TRON-only path', async () => {
    const code = await cmdServeTransfer({
      payTo: '0xabcdef',
      amount: '0.001',
      token: 'USDT',
      network: 'eip155:97',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('UNSUPPORTED_SCHEME');
  });

  it('rejects scheme=exact (only exact_gasfree shipped)', async () => {
    const code = await cmdServeTransfer({
      payTo: 'TJW',
      amount: '0.001',
      token: 'USDT',
      scheme: 'exact',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('UNSUPPORTED_SCHEME');
  });
});

describe('cmdServeTransfer (live HTTP probe)', () => {
  it('starts the server and responds on /health + /.well-known/x402-transfer', async () => {
    const port = 4350 + Math.floor(Math.random() * 100);
    // Run cmdServeTransfer in the background; we never wait for it to finish
    // because it blocks on SIGINT/SIGTERM.
    const startPromise = cmdServeTransfer({
      payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      amount: '0.001',
      token: 'USDT',
      port,
      output: 'json',
    });
    // Give the server a moment to bind.
    await new Promise((r) => setTimeout(r, 100));
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });

      const terms = await fetch(`http://127.0.0.1:${port}/.well-known/x402-transfer`);
      expect(terms.status).toBe(200);
      const body = (await terms.json()) as Record<string, unknown>;
      expect(body.network).toBe('tron:nile');
      expect(body.scheme).toBe('exact_gasfree');
      expect(body.token).toBe('USDT');
      expect(body.amount).toBe('1000');

      const probe = await fetch(`http://127.0.0.1:${port}/pay`);
      expect(probe.status).toBe(402);
      expect(probe.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    } finally {
      process.emit('SIGTERM');
      await startPromise;
    }
  }, 10_000);
});
