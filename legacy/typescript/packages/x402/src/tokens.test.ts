/**
 * Tests for {@link parsePrice} — the price-string → smallest-unit asset amount
 * helper used by ResourceConfig-style server configuration.
 */

import { describe, expect, it } from 'vitest';

import { parsePrice, registerToken } from './tokens.js';

describe('parsePrice', () => {
  it('parses an integer amount on a 6-decimal TRON token', () => {
    const result = parsePrice('1 USDT', 'tron:mainnet');
    expect(result).toMatchObject({
      amount: '1000000',
      asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      decimals: 6,
      symbol: 'USDT',
    });
  });

  it('parses a fractional amount with full decimal precision', () => {
    const result = parsePrice('1.25 USDT', 'tron:mainnet');
    expect(result.amount).toBe('1250000');
  });

  it('parses zero', () => {
    const result = parsePrice('0 USDT', 'tron:mainnet');
    expect(result.amount).toBe('0');
  });

  it('parses 0.000001 (smallest USDT unit)', () => {
    const result = parsePrice('0.000001 USDT', 'tron:mainnet');
    expect(result.amount).toBe('1');
  });

  it('handles an 18-decimal EVM token', () => {
    const result = parsePrice('0.5 USDC', 'eip155:97');
    expect(result.amount).toBe('500000000000000000');
    expect(result.decimals).toBe(18);
  });

  it('is case-insensitive on the symbol lookup', () => {
    const result = parsePrice('1 usdt', 'tron:mainnet');
    expect(result.symbol).toBe('USDT');
  });

  it('tolerates extra whitespace', () => {
    expect(parsePrice('   1.25   USDT  ', 'tron:mainnet').amount).toBe('1250000');
  });

  it('returns the token version when present (DHLU on BSC testnet)', () => {
    const result = parsePrice('1 DHLU', 'eip155:97');
    expect(result.version).toBe('1');
  });

  it('omits version when the token has none', () => {
    const result = parsePrice('1 USDT', 'tron:mainnet');
    expect(result).not.toHaveProperty('version');
  });

  it('throws on malformed price (single token)', () => {
    expect(() => parsePrice('1USDT', 'tron:mainnet')).toThrow(/Invalid price format/);
  });

  it('throws on negative or non-numeric amount', () => {
    expect(() => parsePrice('-1 USDT', 'tron:mainnet')).toThrow(/Invalid amount/);
    expect(() => parsePrice('abc USDT', 'tron:mainnet')).toThrow(/Invalid amount/);
  });

  it('throws on unknown token symbol', () => {
    expect(() => parsePrice('1 NOTOKEN', 'tron:mainnet')).toThrow(/Unknown token/);
  });

  it('throws when amount precision exceeds token decimals', () => {
    // USDT has 6 decimals; 0.0000001 is 7 places
    expect(() => parsePrice('0.0000001 USDT', 'tron:mainnet')).toThrow(/more decimal places/);
  });

  it('picks up custom tokens registered at runtime', () => {
    registerToken('eip155:1', {
      address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
      name: 'Custom USDT',
      symbol: 'CUSDT',
    });
    const result = parsePrice('2 CUSDT', 'eip155:1');
    expect(result.asset).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7');
    expect(result.amount).toBe('2000000');
  });
});
