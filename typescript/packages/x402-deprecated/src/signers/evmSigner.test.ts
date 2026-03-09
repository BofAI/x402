import { describe, it, expect, vi } from 'vitest';
import { EvmClientSigner } from './evmSigner.js';

describe('EvmClientSigner', () => {
  const privateKey =
    '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const expectedAddress = '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c';

  it('should initialize with a private key and derive the correct address', () => {
    const signer = new EvmClientSigner(privateKey);
    expect(signer.getAddress().toLowerCase()).toBe(
      expectedAddress.toLowerCase(),
    );
  });

  it('should initialize without 0x prefix', () => {
    const rawKey = privateKey.slice(2);
    const signer = new EvmClientSigner(rawKey);
    expect(signer.getAddress().toLowerCase()).toBe(
      expectedAddress.toLowerCase(),
    );
  });

  it('should sign a message', async () => {
    const signer = new EvmClientSigner(privateKey);
    const message = new TextEncoder().encode('hello world');
    const signature = await signer.signMessage(message);

    expect(signature).toBeDefined();
    expect(signature.startsWith('0x')).toBe(true);
  });

  it('should sign typed data', async () => {
    const signer = new EvmClientSigner(privateKey);
    const domain = {
      name: 'Test',
      version: '1',
      chainId: 1,
      verifyingContract: '0x0000000000000000000000000000000000000000' as const,
    };
    const types = {
      Person: [
        { name: 'name', type: 'string' },
        { name: 'wallet', type: 'address' },
      ],
    };
    const message = {
      name: 'Bob',
      wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB' as const,
    };

    const signature = await signer.signTypedData(domain, types, message, 'Person');
    expect(signature).toBeDefined();
    expect(signature.startsWith('0x')).toBe(true);
  });
});
