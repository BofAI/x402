/**
 * Local receipt store: append-only JSONL at ~/.x402/receipts.jsonl
 * (overridable via X402_RECEIPT_FILE).
 *
 * The CLI writes one line per successful pay/transfer/server settle.
 * Reads are streamed line-by-line so the file can grow without bloating
 * memory; rotation is post-MVP.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { X402CliError } from './error.js';

export interface Receipt {
  paymentId: string;
  command: 'pay' | 'transfer' | 'server';
  createdAt: string; // ISO 8601
  profile: string;
  network: string;
  scheme: string;
  payer: string;
  payTo: string;
  token: string;
  asset: string;
  amount: string;
  amountDisplay: string;
  feeAmount?: string;
  settlement: {
    success: boolean;
    transaction?: string;
    errorReason?: string | null;
  };
  /** Free-form per-command extras (e.g. server URL for `pay`). */
  extra?: Record<string, unknown>;
}

export function receiptFilePath(): string {
  const override = process.env.X402_RECEIPT_FILE;
  if (override && override.trim()) return path.resolve(override.trim());
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.x402', 'receipts.jsonl');
}

export async function appendReceipt(receipt: Receipt, filePath?: string): Promise<string> {
  const target = filePath ?? receiptFilePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.appendFile(target, JSON.stringify(receipt) + '\n', 'utf8');
  return target;
}

export async function readReceipts(filePath?: string): Promise<Receipt[]> {
  const target = filePath ?? receiptFilePath();
  let raw: string;
  try {
    raw = await fs.readFile(target, 'utf8');
  } catch (err) {
    if (isENOENT(err)) return [];
    throw new X402CliError('IO_ERROR', `Failed to read receipts at ${target}: ${(err as Error).message}`);
  }
  const out: Receipt[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as Receipt);
    } catch {
      // Skip malformed lines — append-only file should never have them, but
      // be tolerant rather than wedge the whole `receipt list` command.
    }
  }
  return out;
}

function isENOENT(err: unknown): boolean {
  return Boolean(err) && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}
