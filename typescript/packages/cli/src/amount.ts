/**
 * Token + amount helpers.
 *
 * `--amount` is human-readable (decimal). `PaymentRequirements.amount` is
 * smallest-unit. Token addresses come from the SDK's static registry; the CLI
 * also supports an explicit `--asset --decimals` override for tokens not in
 * the registry.
 */

import { getToken, findByAddress, type TokenInfo } from '@bankofai/x402';
import { X402CliError } from './error.js';

export interface ResolvedToken {
  symbol: string;
  address: string;
  decimals: number;
  /** Token contract name when the registry knows it; defaults to `symbol`. */
  name: string;
  version: string;
}

export function resolveToken(opts: {
  network: string;
  symbol?: string;
  asset?: string;
  decimals?: number;
}): ResolvedToken {
  const { network } = opts;
  if (opts.asset) {
    if (typeof opts.decimals !== 'number' || !Number.isFinite(opts.decimals) || opts.decimals < 0) {
      // Try to find by address in registry to recover decimals.
      const fallback = findRegistryByAddress(network, opts.asset);
      if (fallback) {
        return toResolved(fallback);
      }
      throw new X402CliError(
        'INVALID_INPUT',
        `When --asset is set without a registry match, --decimals must be a non-negative integer.`,
      );
    }
    return {
      symbol: opts.symbol || 'TOKEN',
      address: opts.asset,
      decimals: opts.decimals,
      name: opts.symbol || 'Token',
      version: '1',
    };
  }
  if (!opts.symbol) {
    throw new X402CliError(
      'INVALID_INPUT',
      `Either --token <symbol> or --asset <address> must be provided.`,
    );
  }
  const info: TokenInfo | undefined = getToken(network, opts.symbol);
  if (!info) {
    throw new X402CliError(
      'TOKEN_NOT_FOUND',
      `Token '${opts.symbol}' is not in the registry for ${network}.`,
      `Pass --asset <address> --decimals <n> to use an out-of-registry token.`,
    );
  }
  return toResolved(info);
}

function toResolved(info: TokenInfo): ResolvedToken {
  return {
    symbol: info.symbol,
    address: info.address,
    decimals: info.decimals,
    name: info.name,
    version: info.version ?? '1',
  };
}

function findRegistryByAddress(network: string, address: string): TokenInfo | undefined {
  return findByAddress(network, address);
}

/**
 * Parse a human-readable amount string into the smallest-unit BigInt.
 *
 * Accepts plain digits ("1"), decimals ("1.25"), and leading-zero decimals
 * ("0.001"). Rejects scientific notation, signs, and trailing junk.
 */
export function parseHumanAmount(amount: string, decimals: number): bigint {
  if (typeof amount !== 'string' || amount.length === 0) {
    throw new X402CliError('INVALID_AMOUNT', `--amount is required.`);
  }
  if (!/^[0-9]+(\.[0-9]+)?$/.test(amount)) {
    throw new X402CliError(
      'INVALID_AMOUNT',
      `--amount must be a non-negative decimal (got '${amount}').`,
    );
  }
  if (decimals < 0 || !Number.isInteger(decimals)) {
    throw new X402CliError('INVALID_INPUT', `decimals must be a non-negative integer.`);
  }
  const [whole, fracRaw = ''] = amount.split('.');
  if (fracRaw.length > decimals) {
    throw new X402CliError(
      'INVALID_AMOUNT',
      `--amount '${amount}' has more decimal places than the token (${decimals}).`,
    );
  }
  const frac = fracRaw.padEnd(decimals, '0');
  const combined = (whole === '' ? '0' : whole) + frac;
  // Strip leading zeros so BigInt() doesn't barf on '01'.
  const normalized = combined.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(normalized);
}

/** Format a smallest-unit BigInt back to a human-readable string. */
export function formatSmallestUnit(
  amount: bigint | string | number,
  decimals: number,
): string {
  const raw =
    typeof amount === 'bigint'
      ? amount
      : typeof amount === 'number'
        ? BigInt(Math.trunc(amount))
        : BigInt(amount || '0');
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  if (decimals <= 0) return (negative ? '-' : '') + abs.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = abs / divisor;
  const frac = abs % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const display = fracStr ? `${whole}.${fracStr}` : whole.toString();
  return negative ? `-${display}` : display;
}

/**
 * Parse a (decimal, amount) pair according to the x402-tools amount
 * convention: exactly one of the two must be present, and the result is
 * always returned in both forms so JSON output can surface them together.
 *
 * `amount` is the protocol-canonical smallest-unit value (matches
 * `PaymentRequirements.amount`); `decimal` is the human-readable form.
 * Both inputs are strings to keep BigInt round-tripping safe.
 */
export interface ParsedAmount {
  /** smallest-unit BigInt — convenience for callers that need bigint math */
  amountBigInt: bigint;
  /** smallest-unit string — what goes into PaymentRequirements.amount */
  amount: string;
  /** human-readable decimal string */
  decimal: string;
}

export function parseAmountFlags(
  decimals: number,
  opts: { decimal?: string; amount?: string },
): ParsedAmount {
  const hasDecimal = typeof opts.decimal === 'string' && opts.decimal.length > 0;
  const hasAmount = typeof opts.amount === 'string' && opts.amount.length > 0;
  if (hasDecimal && hasAmount) {
    throw new X402CliError(
      'INVALID_AMOUNT',
      `--decimal and --amount are mutually exclusive; pass exactly one.`,
    );
  }
  if (!hasDecimal && !hasAmount) {
    throw new X402CliError(
      'INVALID_AMOUNT',
      `Either --decimal <decimal> or --amount <integer> must be provided.`,
    );
  }
  if (hasDecimal) {
    const raw = parseHumanAmount(opts.decimal!, decimals);
    return { amountBigInt: raw, amount: raw.toString(), decimal: opts.decimal! };
  }
  if (!/^[0-9]+$/.test(opts.amount!)) {
    throw new X402CliError(
      'INVALID_AMOUNT',
      `--amount must be a non-negative integer (got '${opts.amount}').`,
    );
  }
  const raw = BigInt(opts.amount!);
  return { amountBigInt: raw, amount: raw.toString(), decimal: formatSmallestUnit(raw, decimals) };
}

/** 16 random bytes as `0x` + 32 lowercase hex chars. */
export function newPaymentId(): string {
  const buf = randomBytes(16);
  return '0x' + Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Node 20+ supplies WebCrypto on globalThis; require fallback for older runtimes.
  const subtleSource = globalThis.crypto;
  if (subtleSource && typeof subtleSource.getRandomValues === 'function') {
    subtleSource.getRandomValues(out);
    return out;
  }
  // Last-resort fallback for runtimes where globalThis.crypto is missing.
  // We import lazily to keep the happy path zero-cost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeCrypto = (globalThis as any).require?.('node:crypto') as typeof import('node:crypto') | undefined;
  if (!nodeCrypto) {
    throw new Error('No CSPRNG available: globalThis.crypto.getRandomValues is missing');
  }
  const buf = nodeCrypto.randomBytes(n);
  out.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  return out;
}
