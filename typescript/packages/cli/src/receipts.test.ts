import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendReceipt, readReceipts, receiptFilePath, type Receipt } from './receipts.js';

let tmpDir: string;
let receiptPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-receipts-'));
  receiptPath = path.join(tmpDir, 'receipts.jsonl');
});

afterEach(async () => {
  delete process.env.X402_RECEIPT_FILE;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function sampleReceipt(paymentId: string): Receipt {
  return {
    paymentId,
    command: 'transfer',
    createdAt: new Date().toISOString(),
    profile: 'nile',
    network: 'tron:nile',
    scheme: 'exact_gasfree',
    payer: 'TTX...',
    payTo: 'TJW...',
    token: 'USDT',
    asset: 'TXYZ...',
    amount: '1000',
    amountDisplay: '0.001 USDT',
    feeAmount: '100000',
    settlement: { success: true, transaction: 'tx-' + paymentId },
  };
}

describe('receipts store', () => {
  it('appends and reads back a receipt', async () => {
    const r = sampleReceipt('a');
    const written = await appendReceipt(r, receiptPath);
    expect(written).toBe(receiptPath);
    const list = await readReceipts(receiptPath);
    expect(list).toHaveLength(1);
    expect(list[0]!.paymentId).toBe('a');
  });

  it('appends multiple receipts in order', async () => {
    await appendReceipt(sampleReceipt('a'), receiptPath);
    await appendReceipt(sampleReceipt('b'), receiptPath);
    await appendReceipt(sampleReceipt('c'), receiptPath);
    const list = await readReceipts(receiptPath);
    expect(list.map((r) => r.paymentId)).toEqual(['a', 'b', 'c']);
  });

  it('returns empty list when file does not exist', async () => {
    const list = await readReceipts(receiptPath);
    expect(list).toEqual([]);
  });

  it('skips malformed lines without throwing', async () => {
    await appendReceipt(sampleReceipt('ok'), receiptPath);
    await fs.appendFile(receiptPath, '{ this is not json\n', 'utf8');
    await appendReceipt(sampleReceipt('also-ok'), receiptPath);
    const list = await readReceipts(receiptPath);
    expect(list.map((r) => r.paymentId)).toEqual(['ok', 'also-ok']);
  });

  it('honors X402_RECEIPT_FILE env override', () => {
    process.env.X402_RECEIPT_FILE = '/tmp/custom-receipts.jsonl';
    expect(receiptFilePath()).toBe('/tmp/custom-receipts.jsonl');
  });
});
