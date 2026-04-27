import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdBalance } from './balance.js';
import { cmdInit } from './config.js';
import { GasFreeAPIClient } from '@bankofai/x402';
import * as onchain from '../onchain.js';

const SAMPLE_KEY = '0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba';

let tmpDir: string;
let cfgPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;
let getInfoSpy: ReturnType<typeof vi.spyOn>;
let chainSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-balance-'));
  cfgPath = path.join(tmpDir, 'config.json');
  process.env.X402_CONFIG_FILE = cfgPath;
  process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
  // Default chain balance mock — tests can override per-case.
  chainSpy = vi
    .spyOn(onchain, 'getTrc20Balance')
    .mockImplementation(async ({ token }) =>
      token === 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf' ? 5_000_000n : 0n,
    );
  getInfoSpy = vi.spyOn(GasFreeAPIClient.prototype, 'getAddressInfo').mockResolvedValue({
    accountAddress: 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i',
    gasFreeAddress: 'TErc7VfxqmXJo5yJmtWsMRE1YEn69jFYUt',
    active: true,
    allowSubmit: true,
    nonce: 5,
    assets: [
      {
        tokenAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        tokenSymbol: 'USDT',
        activateFee: 1000000,
        transferFee: 100000,
        decimal: 6,
        frozen: 0,
        balance: '5000000',
      },
      {
        tokenAddress: 'TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK',
        tokenSymbol: 'USDD',
        activateFee: 1000000,
        transferFee: 100000,
        decimal: 18,
        frozen: 0,
        balance: '0',
      },
    ],
  });
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  delete process.env.TRON_PRIVATE_KEY;
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  getInfoSpy.mockRestore();
  chainSpy.mockRestore();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson(): {
  ok: boolean;
  result: {
    network: string;
    wallet: string;
    gasFreeAddress: string;
    active: boolean;
    nonce: number;
    assets: Array<{
      symbol: string;
      chainBalanceDisplay: string | null;
      apiBalanceDisplay: string;
      apiBalanceStale: boolean;
      transferFee: string;
    }>;
  };
} {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!);
}

describe('cmdBalance', () => {
  it('returns the canonical gasFreeAddress and per-asset details', async () => {
    const code = await cmdBalance({ gasfree: true, output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(env.result.network).toBe('tron:nile');
    expect(env.result.wallet).toMatch(/^TTX1Us\.\.\./);
    expect(env.result.gasFreeAddress).toMatch(/^TErc7V\.\.\./);
    expect(env.result.nonce).toBe(5);
    expect(env.result.assets).toHaveLength(2);
    const usdt = env.result.assets.find((a) => a.symbol === 'USDT')!;
    expect(usdt.chainBalanceDisplay).toBe('5');
    expect(usdt.apiBalanceDisplay).toBe('5');
    expect(usdt.apiBalanceStale).toBe(false);
    expect(usdt.transferFee).toBe('0.1');
  });

  it('shows full addresses when --verbose is set', async () => {
    const code = await cmdBalance({ verbose: true, output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(env.result.wallet).toBe('TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i');
    expect(env.result.gasFreeAddress).toBe('TErc7VfxqmXJo5yJmtWsMRE1YEn69jFYUt');
  });

  it('filters assets by --token symbol', async () => {
    const code = await cmdBalance({ token: 'USDD', output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    expect(env.result.assets).toHaveLength(1);
    expect(env.result.assets[0]!.symbol).toBe('USDD');
  });

  it('falls back to FACILITATOR_UNAVAILABLE when the GasFree client throws', async () => {
    getInfoSpy.mockRejectedValueOnce(new Error('upstream timeout'));
    const code = await cmdBalance({ output: 'json' });
    expect(code).toBe(1);
    const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
    const env = JSON.parse(calls[calls.length - 1]!) as {
      ok: false;
      error: { code: string; message: string };
    };
    expect(env.error.code).toBe('FACILITATOR_UNAVAILABLE');
    expect(env.error.message).toContain('upstream timeout');
  });

  it('formats sub-cent fees correctly at decimals=6', async () => {
    const code = await cmdBalance({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    const usdt = env.result.assets.find((a) => a.symbol === 'USDT')!;
    expect(usdt.transferFee).toBe('0.1');
  });

  it('flags apiBalanceStale + warns to stderr when chain ≠ api', async () => {
    chainSpy.mockResolvedValue(20_000_000n); // chain = 20 USDT, api still says 5
    const code = await cmdBalance({ output: 'json' });
    expect(code).toBe(0);
    const env = lastJson();
    const usdt = env.result.assets.find((a) => a.symbol === 'USDT')!;
    expect(usdt.chainBalanceDisplay).toBe('20');
    expect(usdt.apiBalanceDisplay).toBe('5');
    expect(usdt.apiBalanceStale).toBe(true);
    const stderrOut = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrOut).toMatch(/GasFree API balance is stale/);
  });
});
