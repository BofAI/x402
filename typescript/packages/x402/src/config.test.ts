import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import { getPaymentPermitAddress } from './config.js';

describe('config', () => {
  it('returns checksum payment permit address for EVM networks', () => {
    const addr = getPaymentPermitAddress('eip155:97');
    expect(addr).toBe(getAddress(addr));
  });
});
