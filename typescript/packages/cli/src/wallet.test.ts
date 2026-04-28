import { describe, it, expect, afterEach } from 'vitest';
import { readPrivateKey, deriveWalletInfo } from './wallet.js';

const SAMPLE_KEY = '0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba';
const SAMPLE_TRON_ADDRESS = 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i';

afterEach(() => {
  delete process.env.TRON_PRIVATE_KEY;
  delete process.env.EVM_PRIVATE_KEY;
});

describe('readPrivateKey', () => {
  it('returns the env var verbatim when 0x-prefixed', () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
    expect(readPrivateKey('tron')).toBe(SAMPLE_KEY);
  });

  it('prepends 0x when the env var is bare hex', () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY.slice(2);
    expect(readPrivateKey('tron')).toBe(SAMPLE_KEY);
  });

  it('throws WALLET_NOT_AVAILABLE when the env var is missing', () => {
    expect(() => readPrivateKey('tron')).toThrowError(/WALLET_NOT_AVAILABLE|TRON_PRIVATE_KEY/);
  });

  it('chooses EVM_PRIVATE_KEY for evm wallets', () => {
    process.env.EVM_PRIVATE_KEY = SAMPLE_KEY;
    expect(readPrivateKey('evm')).toBe(SAMPLE_KEY);
  });
});

describe('deriveWalletInfo', () => {
  it('derives the canonical TRON Base58 address from a known key', () => {
    process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
    const w = deriveWalletInfo('tron');
    expect(w.network).toBe('tron');
    expect(w.address).toBe(SAMPLE_TRON_ADDRESS);
    expect(w.evmHexAddress).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('rejects keys whose hex body is not 64 chars', () => {
    process.env.TRON_PRIVATE_KEY = '0xdeadbeef';
    expect(() => deriveWalletInfo('tron')).toThrowError(/64-hex-character|WALLET_NOT_AVAILABLE/);
  });

  it('derives an EVM address from EVM_PRIVATE_KEY', () => {
    process.env.EVM_PRIVATE_KEY = SAMPLE_KEY;
    const w = deriveWalletInfo('evm');
    expect(w.network).toBe('evm');
    expect(w.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(w.evmHexAddress).toBe(w.address.toLowerCase());
  });
});
