import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdInit } from './config.js';
import { cmdRequest } from './request.js';

let tmpDir: string;
let cfgPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

const PAY_TO = 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx';

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-request-'));
  cfgPath = path.join(tmpDir, 'config.json');
  process.env.X402_CONFIG_FILE = cfgPath;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  stdoutSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

describe('cmdRequest', () => {
  it('generates a transfer URI and request object from the default profile', async () => {
    const code = await cmdRequest({
      to: PAY_TO,
      amount: '1.25',
      token: 'USDT',
      format: 'uri',
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { uri: string; request: { amount: string; amountDisplay: string; network: string; scheme: string } } }>();
    expect(env.result.uri).toContain('x402://transfer?');
    expect(env.result.uri).toContain('network=tron%3Anile');
    expect(env.result.request.network).toBe('tron:nile');
    expect(env.result.request.scheme).toBe('exact_permit');
    expect(env.result.request.amount).toBe('1250000');
    expect(env.result.request.amountDisplay).toBe('1.25 USDT');
  });

  it('emits the request object when --format json is selected', async () => {
    const code = await cmdRequest({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      memo: 'invoice 1001',
      expiresIn: 60,
      format: 'json',
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { type: string; memo: string; expiresAt: number; amount: string } }>();
    expect(env.result.type).toBe('x402-transfer-request');
    expect(env.result.memo).toBe('invoice 1001');
    expect(env.result.amount).toBe('1000');
    expect(env.result.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('can generate from built-in defaults when no config file exists', async () => {
    await fs.rm(cfgPath, { force: true });
    const code = await cmdRequest({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      network: 'tron:nile',
      format: 'json',
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { profile: string; network: string; amount: string } }>();
    expect(env.result.profile).toBe('nile');
    expect(env.result.network).toBe('tron:nile');
    expect(env.result.amount).toBe('1000');
  });

  it('rejects missing recipient before doing any network work', async () => {
    const code = await cmdRequest({
      to: '',
      amount: '0.001',
      token: 'USDT',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('rejects unsupported formats', async () => {
    const code = await cmdRequest({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      format: 'xml',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });
});
