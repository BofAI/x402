import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { EvmAddressConverter, toChecksumEvmAddress } from './address.js';

describe('address utils', () => {
  it('checksums a lower-case address', () => {
    const lower = '0x52908400098527886e0f7030069857d2e4169ee7';
    expect(toChecksumEvmAddress(lower)).toBe(getAddress(lower));
  });

  it('adds 0x prefix before checksumming', () => {
    const raw = '52908400098527886e0f7030069857d2e4169ee7';
    expect(toChecksumEvmAddress(raw)).toBe(getAddress(`0x${raw}`));
  });

  it('evm converter returns checksum format', () => {
    const converter = new EvmAddressConverter();
    const lower = '0x8617e340b3d01fa5f11f306f4090fd50e238070d';
    expect(converter.toEvmFormat(lower)).toBe(getAddress(lower));
  });

  it('throws on invalid address in strict mode', () => {
    expect(() => toChecksumEvmAddress('0x1234', { strict: true })).toThrow(
      'Invalid EVM address',
    );
  });
});
