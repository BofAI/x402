import { describe, it, expect } from 'vitest';
import {
  resolveToken,
  parseHumanAmount,
  formatSmallestUnit,
  newPaymentId,
  parseAmountFlags,
} from './amount.js';

describe('resolveToken', () => {
  it('resolves a registry symbol on tron:nile', () => {
    const t = resolveToken({ network: 'tron:nile', symbol: 'USDT' });
    expect(t.symbol).toBe('USDT');
    expect(t.address).toBe('TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf');
    expect(t.decimals).toBe(6);
  });

  it('throws TOKEN_NOT_FOUND when symbol is unknown for the network', () => {
    expect(() => resolveToken({ network: 'tron:nile', symbol: 'GHOST' })).toThrowError(
      /TOKEN_NOT_FOUND|not in the registry/,
    );
  });

  it('accepts an explicit --asset + --decimals override', () => {
    const t = resolveToken({
      network: 'tron:nile',
      asset: 'TYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
      decimals: 8,
      symbol: 'WBTC',
    });
    expect(t.address).toBe('TYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY');
    expect(t.decimals).toBe(8);
  });

  it('rejects --asset without --decimals when not in registry', () => {
    expect(() =>
      resolveToken({
        network: 'tron:nile',
        asset: 'TYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY',
        symbol: 'WBTC',
      }),
    ).toThrowError(/--decimals/);
  });

  it('falls back to registry decimals when --asset matches a registry token', () => {
    const t = resolveToken({
      network: 'tron:nile',
      asset: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    });
    expect(t.decimals).toBe(6);
    expect(t.symbol).toBe('USDT');
  });
});

describe('parseHumanAmount', () => {
  it('parses integer amounts correctly', () => {
    expect(parseHumanAmount('1', 6)).toBe(1_000_000n);
    expect(parseHumanAmount('100', 6)).toBe(100_000_000n);
  });

  it('parses decimal amounts correctly', () => {
    expect(parseHumanAmount('1.25', 6)).toBe(1_250_000n);
    expect(parseHumanAmount('0.001', 6)).toBe(1000n);
    expect(parseHumanAmount('0', 6)).toBe(0n);
    expect(parseHumanAmount('0.000001', 6)).toBe(1n);
  });

  it('handles 18-decimal tokens', () => {
    expect(parseHumanAmount('1.5', 18)).toBe(1_500_000_000_000_000_000n);
  });

  it('rejects more decimals than the token allows', () => {
    expect(() => parseHumanAmount('0.0000001', 6)).toThrowError(/more decimal places/);
  });

  it('rejects non-numeric input', () => {
    expect(() => parseHumanAmount('1e10', 6)).toThrowError(/non-negative decimal/);
    expect(() => parseHumanAmount('-1', 6)).toThrowError(/non-negative decimal/);
    expect(() => parseHumanAmount('1.', 6)).toThrowError(/non-negative decimal/);
    expect(() => parseHumanAmount('abc', 6)).toThrowError(/non-negative decimal/);
    expect(() => parseHumanAmount('', 6)).toThrowError(/--amount is required/);
  });
});

describe('formatSmallestUnit', () => {
  it('renders integer + fractional smallest-unit values', () => {
    expect(formatSmallestUnit(1_250_000n, 6)).toBe('1.25');
    expect(formatSmallestUnit(1000n, 6)).toBe('0.001');
    expect(formatSmallestUnit(0n, 6)).toBe('0');
  });

  it('strips trailing zeros', () => {
    expect(formatSmallestUnit(1_000_000n, 6)).toBe('1');
    expect(formatSmallestUnit(1_500_000n, 6)).toBe('1.5');
  });

  it('handles 18-decimal tokens', () => {
    expect(formatSmallestUnit(1_500_000_000_000_000_000n, 18)).toBe('1.5');
  });
});

describe('newPaymentId', () => {
  it('emits a 0x + 32-hex-character id', () => {
    const id = newPaymentId();
    expect(id).toMatch(/^0x[0-9a-f]{32}$/);
  });

  it('returns distinct values across calls', () => {
    const a = newPaymentId();
    const b = newPaymentId();
    expect(a).not.toBe(b);
  });
});

describe('parseAmountFlags', () => {
  it('accepts --decimal alone', () => {
    expect(parseAmountFlags(6, { decimal: '1.25' })).toEqual({
      amountBigInt: 1_250_000n,
      amount: '1250000',
      decimal: '1.25',
    });
  });

  it('accepts --amount alone and produces a decimal', () => {
    expect(parseAmountFlags(6, { amount: '1250000' })).toEqual({
      amountBigInt: 1_250_000n,
      amount: '1250000',
      decimal: '1.25',
    });
  });

  it('rejects when both --decimal and --amount are provided', () => {
    expect(() => parseAmountFlags(6, { decimal: '1', amount: '1000000' })).toThrowError(
      /mutually exclusive/,
    );
  });

  it('rejects when neither is provided', () => {
    expect(() => parseAmountFlags(6, {})).toThrowError(/must be provided/);
  });

  it('rejects --amount that is not a non-negative integer', () => {
    expect(() => parseAmountFlags(6, { amount: '1.5' })).toThrowError(/non-negative integer/);
    expect(() => parseAmountFlags(6, { amount: '-3' })).toThrowError(/non-negative integer/);
    expect(() => parseAmountFlags(6, { amount: 'abc' })).toThrowError(/non-negative integer/);
  });

  it('round-trips for 18-decimal tokens', () => {
    const a = parseAmountFlags(18, { amount: '1500000000000000000' });
    expect(a.decimal).toBe('1.5');
    expect(a.amount).toBe('1500000000000000000');
  });
});
