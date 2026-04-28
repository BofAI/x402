import { describe, it, expect, afterEach } from 'vitest';
import { getFacilitatorBaseUrl, getSettlementFacilitatorBaseUrl } from './facilitator.js';

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

  it('resolves eip155:97 (and any EVM network) to the root facilitator', () => {
    expect(getFacilitatorBaseUrl('eip155:97')).toBe('https://facilitator.bankofai.io');
    expect(getFacilitatorBaseUrl('eip155:56')).toBe('https://facilitator.bankofai.io');
    expect(getFacilitatorBaseUrl('eip155:1')).toBe('https://facilitator.bankofai.io');
  });

  it('resolves TRON non-GasFree settlement to the root facilitator', () => {
    expect(getSettlementFacilitatorBaseUrl('tron:nile')).toBe('https://facilitator.bankofai.io');
  });

  it('respects the X402_FACILITATOR_URL_OVERRIDE escape hatch', () => {
    process.env.X402_FACILITATOR_URL_OVERRIDE = 'http://127.0.0.1:8013';
    expect(getFacilitatorBaseUrl('tron:nile')).toBe('http://127.0.0.1:8013');
  });

  it('returns root facilitator for any well-formed EVM chain id (even unknown)', () => {
    // We no longer maintain a per-chain slug map; the facilitator decides
    // whether to serve a chain via /supported or /fee/quote. Returning the
    // root URL lets that handshake happen rather than failing client-side.
    expect(getFacilitatorBaseUrl('eip155:9999')).toBe('https://facilitator.bankofai.io');
  });

  it('throws UNSUPPORTED_NETWORK for a malformed network identifier', () => {
    expect(() => getFacilitatorBaseUrl('aptos:mainnet')).toThrowError(/UNSUPPORTED_NETWORK|Unrecognized/);
  });
});
