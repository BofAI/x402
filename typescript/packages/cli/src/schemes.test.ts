import { describe, it, expect } from 'vitest';
import { recommendedSchemes, pickScheme, isKnownScheme } from './schemes.js';

describe('recommendedSchemes', () => {
  it('returns exact for DHLU on BSC testnet (ERC-3009)', () => {
    expect(recommendedSchemes('eip155:97', 'DHLU')).toEqual(['exact']);
  });

  it('returns exact_permit for USDT on BSC testnet (EIP-2612)', () => {
    expect(recommendedSchemes('eip155:97', 'USDT')).toEqual(['exact_permit']);
  });

  it('returns exact_gasfree for USDT on tron:nile', () => {
    expect(recommendedSchemes('tron:nile', 'USDT')).toEqual(['exact_gasfree']);
  });

  it('case-insensitive on token symbol', () => {
    expect(recommendedSchemes('eip155:97', 'usdt')).toEqual(['exact_permit']);
  });

  it('returns null for unknown network', () => {
    expect(recommendedSchemes('cosmos:mainnet', 'USDT')).toBeNull();
  });

  it('returns null for unknown token on a known network', () => {
    expect(recommendedSchemes('eip155:97', 'GHOST')).toBeNull();
  });
});

describe('pickScheme', () => {
  it('picks the first recommended scheme', () => {
    expect(pickScheme('eip155:97', 'DHLU')).toBe('exact');
    expect(pickScheme('tron:nile', 'USDT')).toBe('exact_gasfree');
  });

  it('returns null when nothing is registered', () => {
    expect(pickScheme('eip155:1', 'GHOST')).toBeNull();
  });
});

describe('isKnownScheme', () => {
  it('accepts the three protocol schemes', () => {
    expect(isKnownScheme('exact')).toBe(true);
    expect(isKnownScheme('exact_permit')).toBe(true);
    expect(isKnownScheme('exact_gasfree')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isKnownScheme('upto')).toBe(false);
    expect(isKnownScheme('exact_v2')).toBe(false);
    expect(isKnownScheme('')).toBe(false);
  });
});
