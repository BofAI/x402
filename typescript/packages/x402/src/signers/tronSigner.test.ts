import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TronClientSigner } from './signer.js';
import type { AgentWallet } from './signer.js';
import * as config from '../config.js';
import { TRON_FALLBACK_RPC_URLS } from '../config.js';

vi.mock('@bankofai/agent-wallet', () => ({
  resolveWalletProvider: vi.fn(),
}));

// USDT on TRON mainnet
const MAINNET_USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
// A real EOA wallet address on mainnet
const TEST_WALLET = 'TDqjTkZ3ExHxRzaLSrdnzSBGhfbPXnBQoN';
const FALLBACK_URL = TRON_FALLBACK_RPC_URLS['tron:mainnet'];

function createMockWallet(address: string): AgentWallet {
  return {
    getAddress: vi.fn().mockResolvedValue(address),
    signMessage: vi.fn().mockResolvedValue('0xdeadbeef'),
    signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
    signTransaction: vi.fn().mockResolvedValue('0x1234'),
  };
}

describe('TronClientSigner fallback RPC', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRON_GRID_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses fallback RPC URL and checkBalance succeeds on tron:mainnet without TRON_GRID_API_KEY', async () => {
    const spy = vi.spyOn(config, 'getTronRpcUrl');

    const wallet = createMockWallet(TEST_WALLET);
    const signer = new TronClientSigner(wallet);
    signer.setAddress(TEST_WALLET);

    const balance = await signer.checkBalance(MAINNET_USDT, 'tron:mainnet');

    // Verify getTronRpcUrl was called with mainnet and returned the fallback URL
    expect(spy).toHaveBeenCalledWith('tron:mainnet');
    expect(spy).toHaveReturnedWith(FALLBACK_URL);

    // Verify the RPC call actually succeeded and returned a valid bigint
    expect(typeof balance).toBe('bigint');
    expect(balance).toBeGreaterThanOrEqual(BigInt(0));

    spy.mockRestore();
  });
});
