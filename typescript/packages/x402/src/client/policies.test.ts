import { describe, it, expect, vi } from 'vitest';
import { X402Client, SufficientBalancePolicy } from '../index.js';
import type { PaymentRequirements } from '../index.js';

describe('SufficientBalancePolicy (GasFree)', () => {
  it('filters exact_gasfree when GasFree balance is insufficient and falls back', async () => {
    const network = 'tron:nile';
    const asset = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
    const gasfreeAddress = 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC';

    const gasfreeSigner = {
      checkBalance: vi.fn(async (_asset: string, _network: string, address?: string) => {
        if (address === gasfreeAddress) return 1100n;
        return 9999n;
      }),
    };

    const exactSigner = {
      checkBalance: vi.fn(async () => 9999n),
    };

    const gasfreeMechanism = {
      scheme: () => 'exact_gasfree',
      getSigner: () => gasfreeSigner,
      resolveBalanceCheckContext: vi.fn().mockResolvedValue({
        address: gasfreeAddress,
        extraNeeded: 200n,
      }),
      createPaymentPayload: async () => {
        throw new Error('not used');
      },
    };

    const exactMechanism = {
      scheme: () => 'exact',
      getSigner: () => exactSigner,
      createPaymentPayload: async () => {
        throw new Error('not used');
      },
    };

    const client = new X402Client();
    client.register('tron:*', gasfreeMechanism as any);
    client.register('tron:*', exactMechanism as any);

    const policy = new SufficientBalancePolicy(client);
    const requirements: PaymentRequirements[] = [
      {
        scheme: 'exact_gasfree',
        network,
        amount: '1000',
        asset,
        payTo: 'TTestPayTo',
        extra: {
          fee: { feeTo: 'TTestFeeTo', feeAmount: '1000' },
        },
      },
      {
        scheme: 'exact',
        network,
        amount: '500',
        asset,
        payTo: 'TTestPayTo',
      },
    ];

    const result = await policy.apply(requirements);

    expect(result.map((r) => r.scheme)).toEqual(['exact']);
    expect(gasfreeSigner.checkBalance).toHaveBeenCalledWith(asset, network, gasfreeAddress);
  });

  it('uses scheme-specific extraNeeded instead of fee amount', async () => {
    const network = 'tron:nile';
    const asset = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
    const gasfreeAddress = 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC';

    const gasfreeSigner = {
      checkBalance: vi.fn(async (_asset: string, _network: string, address?: string) => {
        if (address === gasfreeAddress) return 1500n;
        return 0n;
      }),
    };

    const gasfreeMechanism = {
      scheme: () => 'exact_gasfree',
      getSigner: () => gasfreeSigner,
      resolveBalanceCheckContext: vi.fn().mockResolvedValue({
        address: gasfreeAddress,
        extraNeeded: 200n,
      }),
      createPaymentPayload: async () => {
        throw new Error('not used');
      },
    };

    const client = new X402Client();
    client.register('tron:*', gasfreeMechanism as any);

    const policy = new SufficientBalancePolicy(client);
    const requirements: PaymentRequirements[] = [
      {
        scheme: 'exact_gasfree',
        network,
        amount: '1000',
        asset,
        payTo: 'TTestPayTo',
        extra: {
          fee: { feeTo: 'TTestFeeTo', feeAmount: '1000' },
        },
      },
    ];

    const result = await policy.apply(requirements);

    expect(result.map((r) => r.scheme)).toEqual(['exact_gasfree']);
    expect(gasfreeSigner.checkBalance).toHaveBeenCalledWith(asset, network, gasfreeAddress);
  });
});
