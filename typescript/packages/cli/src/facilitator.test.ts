import { describe, it, expect, afterEach } from 'vitest';
import { getFacilitatorBaseUrl } from './facilitator.js';

afterEach(() => {
  delete process.env.X402_FACILITATOR_URL_OVERRIDE;
});

describe('getFacilitatorBaseUrl', () => {
  it('resolves tron:nile to the BankofAI Nile proxy', () => {
    expect(getFacilitatorBaseUrl('tron:nile')).toBe('https://facilitator.bankofai.io/nile');
  });

  it('resolves tron:mainnet to the BankofAI mainnet proxy', () => {
    expect(getFacilitatorBaseUrl('tron:mainnet')).toBe('https://facilitator.bankofai.io/mainnet');
  });

  it('resolves eip155:97 to the BSC testnet endpoint', () => {
    expect(getFacilitatorBaseUrl('eip155:97')).toBe('https://facilitator.bankofai.io/bsc-testnet');
  });

  it('respects the X402_FACILITATOR_URL_OVERRIDE escape hatch', () => {
    process.env.X402_FACILITATOR_URL_OVERRIDE = 'http://127.0.0.1:8013';
    expect(getFacilitatorBaseUrl('tron:nile')).toBe('http://127.0.0.1:8013');
  });

  it('throws UNSUPPORTED_NETWORK for an unknown EVM chain', () => {
    expect(() => getFacilitatorBaseUrl('eip155:9999')).toThrowError(/UNSUPPORTED_NETWORK|configured/);
  });

  it('throws UNSUPPORTED_NETWORK for a malformed network identifier', () => {
    expect(() => getFacilitatorBaseUrl('aptos:mainnet')).toThrowError(/UNSUPPORTED_NETWORK|Unrecognized/);
  });
});
