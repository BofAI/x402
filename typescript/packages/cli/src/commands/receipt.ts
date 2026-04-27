/**
 * `x402 receipt` — query the local receipt store.
 *
 * The store is append-only JSONL at ~/.x402/receipts.jsonl (override via
 * X402_RECEIPT_FILE). All reads are local; the command never touches the
 * network or a wallet.
 */

import { runCommand, type OutputMode, maskAddress } from '../output.js';
import { readReceipts, receiptFilePath, type Receipt } from '../receipts.js';
import { X402CliError } from '../error.js';

export interface ReceiptListOpts {
  profile?: string;
  network?: string;
  scheme?: string;
  token?: string;
  from?: string;
  to?: string;
  limit?: number;
  output: OutputMode;
}

export async function cmdReceiptList(opts: ReceiptListOpts): Promise<number> {
  return runCommand({ command: 'receipt list' }, opts.output, async () => {
    const all = await readReceipts();
    const filtered = all.filter((r) => match(r, opts));
    const limited = typeof opts.limit === 'number' ? filtered.slice(-opts.limit) : filtered;
    return {
      path: receiptFilePath(),
      total: all.length,
      matched: filtered.length,
      receipts: limited.map((r) => ({
        paymentId: r.paymentId,
        command: r.command,
        createdAt: r.createdAt,
        profile: r.profile,
        network: r.network,
        scheme: r.scheme,
        payer: maskAddress(r.payer),
        payTo: maskAddress(r.payTo),
        token: r.token,
        amountDisplay: r.amountDisplay,
        feeAmount: r.feeAmount,
        success: r.settlement.success,
        transaction: r.settlement.transaction ?? null,
      })),
    };
  });
}

export async function cmdReceiptShow(idOrTx: string, output: OutputMode): Promise<number> {
  return runCommand({ command: 'receipt show' }, output, async () => {
    const all = await readReceipts();
    const match = all.find(
      (r) => r.paymentId === idOrTx || r.settlement.transaction === idOrTx,
    );
    if (!match) {
      throw new X402CliError(
        'RECEIPT_NOT_FOUND',
        `No receipt found for paymentId or tx hash '${idOrTx}'.`,
        `Run \`x402 receipt list\` to see all receipts.`,
      );
    }
    return match;
  });
}

export async function cmdReceiptExport(format: string, output: OutputMode): Promise<number> {
  return runCommand({ command: 'receipt export' }, output, async () => {
    const all = await readReceipts();
    if (format === 'json') {
      return { count: all.length, receipts: all };
    }
    if (format === 'csv') {
      const header = [
        'paymentId',
        'command',
        'createdAt',
        'profile',
        'network',
        'scheme',
        'payer',
        'payTo',
        'token',
        'amount',
        'amountDisplay',
        'feeAmount',
        'success',
        'transaction',
      ];
      const rows = all.map((r) => [
        r.paymentId,
        r.command,
        r.createdAt,
        r.profile,
        r.network,
        r.scheme,
        r.payer,
        r.payTo,
        r.token,
        r.amount,
        r.amountDisplay,
        r.feeAmount ?? '',
        String(r.settlement.success),
        r.settlement.transaction ?? '',
      ]);
      const escape = (v: unknown) => {
        const s = String(v ?? '');
        if (/["\n,]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
      };
      const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
      return { count: all.length, format: 'csv', csv };
    }
    throw new X402CliError(
      'INVALID_INPUT',
      `Unsupported export format '${format}'. Use 'json' or 'csv'.`,
    );
  });
}

function match(r: Receipt, opts: ReceiptListOpts): boolean {
  if (opts.profile && r.profile !== opts.profile) return false;
  if (opts.network && r.network !== opts.network) return false;
  if (opts.scheme && r.scheme !== opts.scheme) return false;
  if (opts.token && r.token !== opts.token) return false;
  if (opts.from && new Date(r.createdAt).getTime() < parseDate(opts.from)) return false;
  if (opts.to && new Date(r.createdAt).getTime() > parseDate(opts.to)) return false;
  return true;
}

function parseDate(input: string): number {
  if (/^\d+$/.test(input)) return Number.parseInt(input, 10) * 1000;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    throw new X402CliError(
      'INVALID_INPUT',
      `Cannot parse '${input}' as a date. Use a unix timestamp (seconds) or ISO 8601.`,
    );
  }
  return d.getTime();
}
