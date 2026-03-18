import { describe, it, expect, vi } from 'vitest';
import { resolveWalletProvider } from '@bankofai/agent-wallet';
import { EvmClientSigner } from './evmSigner.js';
import type { AgentWallet } from './signer.js';

/** Creates a mock wallet for testing. */
function createMockWallet(address: string): AgentWallet {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    signMessage: vi.fn().mockResolvedValue('0xdeadbeef'),
    signTypedData: vi.fn().mockResolvedValue('0xcafebabe'),
    signTransaction: vi.fn().mockResolvedValue('0x1234'),
  };
}

vi.mock('@bankofai/agent-wallet', () => ({
  resolveWalletProvider: vi.fn(),
}));

describe('EvmClientSigner', () => {
  const expectedAddress = '0xFCAd0B19bB29D4674531d6f115237E16AfCE377c';

  it('should initialize with wallet and address', () => {
    const wallet = createMockWallet(expectedAddress);
    const signer = new EvmClientSigner(wallet, expectedAddress);
    expect(signer.getAddress().toLowerCase()).toBe(
      expectedAddress.toLowerCase(),
    );
  });

  it('should create via async factory', async () => {
    const wallet = createMockWallet(expectedAddress);
    vi.mocked(resolveWalletProvider).mockReturnValue({
      getActiveWallet: vi.fn().mockResolvedValue(wallet),
    });

    const signer = await EvmClientSigner.create();
    expect(signer.getAddress().toLowerCase()).toBe(
      expectedAddress.toLowerCase(),
    );
    expect(wallet.getAddress).toHaveBeenCalledOnce();
  });

  it('should delegate signMessage to wallet', async () => {
    const wallet = createMockWallet(expectedAddress);
    const signer = new EvmClientSigner(wallet, expectedAddress);
    const message = new TextEncoder().encode('hello world');
    const signature = await signer.signMessage(message);

    expect(wallet.signMessage).toHaveBeenCalledWith(message);
    expect(signature).toBe('0xdeadbeef');
  });

  it('should delegate signTypedData to wallet', async () => {
    const wallet = createMockWallet(expectedAddress);
    const signer = new EvmClientSigner(wallet, expectedAddress);
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
    expect(wallet.signTypedData).toHaveBeenCalled();
    expect(signature).toBe('0xcafebabe');
  });
});
