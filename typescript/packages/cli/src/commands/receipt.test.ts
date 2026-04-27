import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdReceiptList, cmdReceiptShow, cmdReceiptExport } from './receipt.js';
import { appendReceipt, type Receipt } from '../receipts.js';

let tmpDir: string;
let receiptPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-receipt-cmd-'));
  receiptPath = path.join(tmpDir, 'receipts.jsonl');
  process.env.X402_RECEIPT_FILE = receiptPath;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(async () => {
  delete process.env.X402_RECEIPT_FILE;
  stdoutSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

function makeReceipt(overrides: Partial<Receipt>): Receipt {
  return {
    paymentId: 'pid',
    command: 'transfer',
    createdAt: '2026-04-27T08:00:00.000Z',
    profile: 'nile',
    network: 'tron:nile',
    scheme: 'exact_gasfree',
    payer: 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i',
    payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
    token: 'USDT',
    asset: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    amount: '1000',
    amountDisplay: '0.001 USDT',
    settlement: { success: true, transaction: 'tx-default' },
    ...overrides,
  };
}

describe('cmdReceiptList', () => {
  it('returns all receipts when no filters', async () => {
    await appendReceipt(makeReceipt({ paymentId: 'a' }));
    await appendReceipt(makeReceipt({ paymentId: 'b' }));
    const code = await cmdReceiptList({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson<{ result: { total: number; matched: number; receipts: Array<{ paymentId: string; payer: string }> } }>();
    expect(env.result.total).toBe(2);
    expect(env.result.matched).toBe(2);
    expect(env.result.receipts.map((r) => r.paymentId)).toEqual(['a', 'b']);
    expect(env.result.receipts[0]!.payer).toBe('TTX1Us...3J3i');
  });

  it('filters by token', async () => {
    await appendReceipt(makeReceipt({ paymentId: 'a', token: 'USDT' }));
    await appendReceipt(makeReceipt({ paymentId: 'b', token: 'USDD' }));
    await cmdReceiptList({ token: 'USDD', output: 'json' });
    const env = lastJson<{ result: { matched: number; receipts: Array<{ paymentId: string }> } }>();
    expect(env.result.matched).toBe(1);
    expect(env.result.receipts[0]!.paymentId).toBe('b');
  });

  it('respects --limit', async () => {
    for (let i = 0; i < 5; i++) {
      await appendReceipt(makeReceipt({ paymentId: 'pid-' + i }));
    }
    await cmdReceiptList({ limit: 2, output: 'json' });
    const env = lastJson<{ result: { matched: number; receipts: Array<{ paymentId: string }> } }>();
    expect(env.result.matched).toBe(5);
    expect(env.result.receipts).toHaveLength(2);
    expect(env.result.receipts.map((r) => r.paymentId)).toEqual(['pid-3', 'pid-4']);
  });

  it('returns empty list when no receipts exist', async () => {
    await cmdReceiptList({ output: 'json' });
    const env = lastJson<{ result: { total: number; matched: number; receipts: unknown[] } }>();
    expect(env.result.total).toBe(0);
    expect(env.result.receipts).toEqual([]);
  });
});

describe('cmdReceiptShow', () => {
  beforeEach(async () => {
    await appendReceipt(makeReceipt({ paymentId: 'p1', settlement: { success: true, transaction: '0xaa' } }));
    await appendReceipt(makeReceipt({ paymentId: 'p2', settlement: { success: true, transaction: '0xbb' } }));
    stdoutSpy.mockClear();
  });

  it('finds by paymentId', async () => {
    const code = await cmdReceiptShow('p1', 'json');
    expect(code).toBe(0);
    const env = lastJson<{ result: { paymentId: string } }>();
    expect(env.result.paymentId).toBe('p1');
  });

  it('finds by transaction hash', async () => {
    const code = await cmdReceiptShow('0xbb', 'json');
    expect(code).toBe(0);
    const env = lastJson<{ result: { paymentId: string } }>();
    expect(env.result.paymentId).toBe('p2');
  });

  it('returns RECEIPT_NOT_FOUND for unknown id', async () => {
    const code = await cmdReceiptShow('ghost', 'json');
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('RECEIPT_NOT_FOUND');
  });
});

describe('cmdReceiptExport', () => {
  beforeEach(async () => {
    await appendReceipt(makeReceipt({ paymentId: 'p1' }));
    await appendReceipt(makeReceipt({ paymentId: 'p2' }));
    stdoutSpy.mockClear();
  });

  it('exports as JSON by default', async () => {
    const code = await cmdReceiptExport('json', 'json');
    expect(code).toBe(0);
    const env = lastJson<{ result: { count: number; receipts: Array<{ paymentId: string }> } }>();
    expect(env.result.count).toBe(2);
    expect(env.result.receipts.map((r) => r.paymentId)).toEqual(['p1', 'p2']);
  });

  it('exports as CSV with quoted header + rows', async () => {
    const code = await cmdReceiptExport('csv', 'json');
    expect(code).toBe(0);
    const env = lastJson<{ result: { format: string; csv: string } }>();
    expect(env.result.format).toBe('csv');
    expect(env.result.csv.split('\n')[0]).toContain('paymentId,command');
    expect(env.result.csv.split('\n')).toHaveLength(3); // header + 2 rows
  });

  it('rejects unsupported formats', async () => {
    const code = await cmdReceiptExport('xml', 'json');
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });
});
