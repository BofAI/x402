import { describe, expect, it, vi } from 'vitest';
import { ExactEvmClientMechanism } from './nativeExactEvm.js';
import type { ClientSigner } from '../client/x402Client.js';

describe('ExactEvmClientMechanism', () => {
  const signer: ClientSigner = {
    getAddress: () => '0x1111111111111111111111111111111111111111',
    signMessage: vi.fn(),
    signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
    checkBalance: vi.fn(),
    checkAllowance: vi.fn(),
    ensureAllowance: vi.fn(),
  };

  it('writes exact authorization into payload.authorization', async () => {
    const mechanism = new ExactEvmClientMechanism(signer);

    const payload = await mechanism.createPaymentPayload(
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '1000000',
        asset: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        payTo: '0x2222222222222222222222222222222222222222',
        extra: {
          name: 'USD Coin',
          version: '2',
        },
      },
      'https://example.com/resource',
    );

    expect(payload.payload.authorization).toBeDefined();
    expect(payload.payload.authorization?.value).toBe('1000000');
    expect(payload.payload.authorization?.to).toBe('0x2222222222222222222222222222222222222222');
    expect(payload.extensions?.transferAuthorization).toEqual(payload.payload.authorization);
  });
});
