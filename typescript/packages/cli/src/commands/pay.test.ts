import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdPay } from './pay.js';
import { cmdInit } from './config.js';
import { TronClientSigner, X402FetchClient, encodePaymentPayload } from '@bankofai/x402';

const SAMPLE_KEY = '0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba';
const SAMPLE_ADDR = 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i';

let tmpDir: string;
let cfgPath: string;
let receiptPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-pay-'));
  cfgPath = path.join(tmpDir, 'config.json');
  receiptPath = path.join(tmpDir, 'receipts.jsonl');
  process.env.X402_CONFIG_FILE = cfgPath;
  process.env.X402_RECEIPT_FILE = receiptPath;
  process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  delete process.env.X402_RECEIPT_FILE;
  delete process.env.TRON_PRIVATE_KEY;
  delete process.env.EVM_PRIVATE_KEY;
  stdoutSpy.mockRestore();
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

describe('cmdPay', () => {
  it('rejects an empty URL', async () => {
    const code = await cmdPay({ url: '', output: 'json' });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('requires EVM_PRIVATE_KEY for EVM pay networks', async () => {
    const code = await cmdPay({
      url: 'http://127.0.0.1:0/pay',
      network: 'eip155:97',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('WALLET_NOT_AVAILABLE');
  });

  it('--dry-run reports server accepts when 402 is returned', async () => {
    const accepts = [
      {
        scheme: 'exact_gasfree',
        network: 'tron:nile',
        amount: '1000',
        asset: 'TXYZ',
        payTo: 'TJW',
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ x402Version: 2, accepts }), {
        status: 402,
        headers: {
          'PAYMENT-REQUIRED': encodePaymentPayload({ x402Version: 2, accepts }),
        },
      }) as unknown as Response,
    );
    const code = await cmdPay({
      url: 'http://127.0.0.1:0/pay',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { dryRun: boolean; status: number; accepts: unknown[] } }>();
    expect(env.result.dryRun).toBe(true);
    expect(env.result.status).toBe(402);
    expect(Array.isArray(env.result.accepts)).toBe(true);
    fetchSpy.mockRestore();
  });

  it('--dry-run notes when server returns non-402', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('hello', { status: 200 }) as unknown as Response,
    );
    const code = await cmdPay({
      url: 'http://127.0.0.1:0/pay',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { status: number; note: string } }>();
    expect(env.result.status).toBe(200);
    expect(env.result.note).toMatch(/did not return 402/);
    fetchSpy.mockRestore();
  });

  it('writes a receipt and returns 200 envelope on successful pay', async () => {
    const settlement = {
      success: true,
      transaction: '0xabc' + 'def'.repeat(20),
      network: 'tron:nile',
    };
    vi.spyOn(TronClientSigner, 'create').mockImplementation(async () =>
      ({ getAddress: () => SAMPLE_ADDR } as unknown as TronClientSigner),
    );
    vi.spyOn(X402FetchClient.prototype, 'request').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, hello: 'world' }), {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': encodePaymentPayload(settlement) },
      }) as unknown as Response,
    );
    const code = await cmdPay({ url: 'http://127.0.0.1:0/pay', output: 'json' });
    expect(code).toBe(0);
    const env = lastJson<{
      result: { status: number; paymentResponse: typeof settlement };
    }>();
    expect(env.result.status).toBe(200);
    expect(env.result.paymentResponse.transaction).toBe(settlement.transaction);
    const receipts = await fs.readFile(receiptPath, 'utf8');
    const r = JSON.parse(receipts.trim());
    expect(r.command).toBe('pay');
    expect(r.settlement.transaction).toBe(settlement.transaction);
  });

  it('registers EVM exact/exact_permit pay when EVM_PRIVATE_KEY is present', async () => {
    process.env.EVM_PRIVATE_KEY = SAMPLE_KEY;
    const settlement = {
      success: true,
      transaction: '0xabc' + '123'.repeat(20),
      network: 'eip155:97',
    };
    vi.spyOn(X402FetchClient.prototype, 'request').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': encodePaymentPayload(settlement) },
      }) as unknown as Response,
    );
    const code = await cmdPay({
      url: 'http://127.0.0.1:0/pay',
      network: 'eip155:97',
      scheme: 'exact_permit',
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ result: { status: number; paymentResponse: typeof settlement } }>();
    expect(env.result.status).toBe(200);
    expect(env.result.paymentResponse.network).toBe('eip155:97');
  });

  it('returns SETTLE_FAILED when the post-payment response is 4xx', async () => {
    vi.spyOn(TronClientSigner, 'create').mockImplementation(async () =>
      ({ getAddress: () => SAMPLE_ADDR } as unknown as TronClientSigner),
    );
    vi.spyOn(X402FetchClient.prototype, 'request').mockResolvedValue(
      new Response('{"error":"boom"}', { status: 500 }) as unknown as Response,
    );
    const code = await cmdPay({ url: 'http://127.0.0.1:0/pay', output: 'json' });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('SETTLE_FAILED');
  });
});
