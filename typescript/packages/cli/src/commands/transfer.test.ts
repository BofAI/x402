import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cmdTransfer } from './transfer.js';
import { cmdInit } from './config.js';
import { GasFreeAPIClient, TronClientSigner, X402Client } from '@bankofai/x402';

const SAMPLE_KEY = '0xddb8ff7605526a250bd37f5c3733badf9860f8708e808b79f40f8c56470004ba';
const SAMPLE_TRON = 'TTX1Us19zqsLXhY39PPR7KRUoMa93s3J3i';
const PAY_TO = 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx';

let tmpDir: string;
let cfgPath: string;
let receiptPath: string;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

const makeAccountInfo = (overrides: Partial<{ active: boolean; nonce: number; assets: unknown[] }> = {}) => ({
  accountAddress: SAMPLE_TRON,
  gasFreeAddress: 'TErc7VfxqmXJo5yJmtWsMRE1YEn69jFYUt',
  active: overrides.active ?? true,
  allowSubmit: true,
  nonce: overrides.nonce ?? 1,
  assets: overrides.assets ?? [
    {
      tokenAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
      tokenSymbol: 'USDT',
      activateFee: 1_000_000,
      transferFee: 100_000,
      decimal: 6,
      frozen: 0,
      balance: '5000000',
    },
  ],
});

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'x402-cli-transfer-'));
  cfgPath = path.join(tmpDir, 'config.json');
  receiptPath = path.join(tmpDir, 'receipts.jsonl');
  process.env.X402_CONFIG_FILE = cfgPath;
  process.env.X402_RECEIPT_FILE = receiptPath;
  process.env.TRON_PRIVATE_KEY = SAMPLE_KEY;
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  await cmdInit({ output: 'json' });
  stdoutSpy.mockClear();
});

afterEach(async () => {
  delete process.env.X402_CONFIG_FILE;
  delete process.env.X402_RECEIPT_FILE;
  delete process.env.TRON_PRIVATE_KEY;
  stdoutSpy.mockRestore();
  vi.restoreAllMocks();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function lastJson<T = unknown>(): T {
  const calls = stdoutSpy.mock.calls.map((c) => String(c[0])).filter((s) => s.startsWith('{'));
  return JSON.parse(calls[calls.length - 1]!) as T;
}

describe('cmdTransfer', () => {
  it('--dry-run reports the resolved plan without signing or settling', async () => {
    vi.spyOn(GasFreeAPIClient.prototype, 'getAddressInfo').mockResolvedValue(makeAccountInfo());
    const code = await cmdTransfer({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      dryRun: true,
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ ok: boolean; result: { dryRun: boolean; amount: string; payTo: string; estimatedTransferFee: string } }>();
    expect(env.ok).toBe(true);
    expect(env.result.dryRun).toBe(true);
    expect(env.result.amount).toBe('1000');
    expect(env.result.payTo).toBe(PAY_TO);
    expect(env.result.estimatedTransferFee).toBe('100000');
  });

  it('rejects --scheme other than exact_gasfree', async () => {
    const code = await cmdTransfer({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      scheme: 'exact',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('UNSUPPORTED_SCHEME');
  });

  it('rejects EVM networks (post-MVP for transfer)', async () => {
    const code = await cmdTransfer({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      network: 'eip155:97',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('UNSUPPORTED_NETWORK');
  });

  it('rejects --to omitted', async () => {
    const code = await cmdTransfer({
      to: '',
      amount: '0.001',
      token: 'USDT',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string } }>();
    expect(env.error.code).toBe('INVALID_INPUT');
  });

  it('runs the full sign+submit path and writes a receipt on success', async () => {
    vi.spyOn(GasFreeAPIClient.prototype, 'getAddressInfo').mockResolvedValue(makeAccountInfo());
    const submitSpy = vi
      .spyOn(GasFreeAPIClient.prototype, 'submit')
      .mockResolvedValue('trace-1234');
    const waitSpy = vi
      .spyOn(GasFreeAPIClient.prototype, 'waitForSuccess')
      .mockResolvedValue({
        id: 'trace-1234',
        state: 'SUCCEED',
        createdAt: '2026-04-27T00:00:00.000Z',
        accountAddress: SAMPLE_TRON,
        gasFreeAddress: 'TErc...',
        providerAddress: 'TKtWb...',
        targetAddress: PAY_TO,
        nonce: 1,
        tokenAddress: 'TXYZ...',
        amount: '1000',
        expiredAt: '2026-04-27T00:30:00.000Z',
        txnHash: '0x' + 'ab'.repeat(32),
        txnState: 'ON_CHAIN',
      });
    vi.spyOn(TronClientSigner, 'create').mockImplementation(async () => {
      // Mechanism is mocked at X402Client.createPaymentPayload, but transfer.ts
      // calls signer.getAddress() to build the receipt; supply that method.
      return { getAddress: () => SAMPLE_TRON } as unknown as TronClientSigner;
    });
    vi.spyOn(X402Client.prototype, 'registerGasFree').mockImplementation(function (this: X402Client) {
      return this;
    });
    vi.spyOn(X402Client.prototype, 'createPaymentPayload').mockResolvedValue({
      x402Version: 2,
      accepted: {
        scheme: 'exact_gasfree',
        network: 'tron:nile',
        amount: '1000',
        asset: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
        payTo: PAY_TO,
      },
      payload: {
        signature: '0x' + 'cd'.repeat(65),
        paymentPermit: {
          meta: {
            kind: 'PAYMENT_ONLY',
            paymentId: '0x' + '1'.repeat(32),
            nonce: '1',
            validAfter: 0,
            validBefore: Math.floor(Date.now() / 1000) + 600,
          },
          buyer: SAMPLE_TRON,
          caller: 'TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E',
          payment: {
            payToken: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
            payAmount: '1000',
            payTo: PAY_TO,
          },
          fee: { feeTo: 'TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E', feeAmount: '100000' },
        },
      },
    });

    const code = await cmdTransfer({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      output: 'json',
    });
    expect(code).toBe(0);
    const env = lastJson<{ ok: true; result: { transaction: string; traceId: string; payer: string } }>();
    expect(env.result.transaction).toMatch(/^0xab+/);
    expect(env.result.traceId).toBe('trace-1234');
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(waitSpy).toHaveBeenCalledWith('trace-1234');

    const receiptRaw = await fs.readFile(receiptPath, 'utf8');
    const receipt = JSON.parse(receiptRaw.trim());
    expect(receipt.command).toBe('transfer');
    expect(receipt.settlement.success).toBe(true);
    expect(receipt.settlement.transaction).toBe(env.result.transaction);
  });

  it('surfaces SETTLE_FAILED when GasFree submit throws', async () => {
    vi.spyOn(GasFreeAPIClient.prototype, 'getAddressInfo').mockResolvedValue(makeAccountInfo());
    vi.spyOn(GasFreeAPIClient.prototype, 'submit').mockRejectedValue(
      new Error('too many pending transfers'),
    );
    vi.spyOn(TronClientSigner, 'create').mockImplementation(async () =>
      ({ getAddress: () => SAMPLE_TRON } as unknown as TronClientSigner),
    );
    vi.spyOn(X402Client.prototype, 'registerGasFree').mockImplementation(function (this: X402Client) {
      return this;
    });
    vi.spyOn(X402Client.prototype, 'createPaymentPayload').mockResolvedValue({
      x402Version: 2,
      accepted: {} as never,
      payload: {
        signature: 'sig',
        paymentPermit: {
          meta: { kind: 'PAYMENT_ONLY', paymentId: 'pid', nonce: '0', validAfter: 0, validBefore: 0 },
          buyer: SAMPLE_TRON,
          caller: 'caller',
          payment: { payToken: 'tok', payAmount: '1000', payTo: PAY_TO },
          fee: { feeTo: 'caller', feeAmount: '0' },
        },
      },
    });
    const code = await cmdTransfer({
      to: PAY_TO,
      amount: '0.001',
      token: 'USDT',
      output: 'json',
    });
    expect(code).toBe(1);
    const env = lastJson<{ ok: false; error: { code: string; message: string } }>();
    expect(env.error.code).toBe('SETTLE_FAILED');
    expect(env.error.message).toContain('too many pending transfers');
  });
});
