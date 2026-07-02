import { describe, it, expect, vi } from 'vitest';
import { SufficientBalancePolicy } from './policies.js';
import type { ClientMechanism, ClientSigner } from './x402Client.js';
import { X402Client } from './x402Client.js';
import type { PaymentRequirements } from '../types/index.js';

function makeRequirement(overrides?: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: 'exact_permit',
    network: 'tron:nile',
    amount: '1000000',
    asset: 'TTestUSDT',
    payTo: 'TTestMerchant',
    ...overrides,
  } as PaymentRequirements;
}

function makeSigner(balance: bigint): ClientSigner {
  return {
    getAddress: () => 'TMockAddress',
    signMessage: vi.fn(),
    signTypedData: vi.fn(),
    checkBalance: vi.fn().mockResolvedValue(balance),
    checkAllowance: vi.fn(),
    ensureAllowance: vi.fn(),
  } as unknown as ClientSigner;
}

function makeMechanism(opts: {
  scheme?: string;
  signer?: ClientSigner;
  checkBalance?: (token: string, network: string) => Promise<bigint>;
}): ClientMechanism {
  const mechanism: ClientMechanism = {
    scheme: () => opts.scheme ?? 'exact_permit',
    getSigner: () => opts.signer ?? null,
    createPaymentPayload: vi.fn(),
  };
  if (opts.checkBalance) {
    mechanism.checkBalance = opts.checkBalance;
  }
  return mechanism;
}

describe('SufficientBalancePolicy', () => {
  it('keeps requirement when mechanism.checkBalance returns sufficient balance', async () => {
    const client = new X402Client();
    const mechanism = makeMechanism({
      checkBalance: vi.fn().mockResolvedValue(5000000n),
    });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement({ amount: '1000000' })]);
    expect(result).toHaveLength(1);
  });

  it('drops requirement when mechanism.checkBalance returns insufficient balance', async () => {
    const client = new X402Client();
    const mechanism = makeMechanism({
      checkBalance: vi.fn().mockResolvedValue(500n),
    });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement({ amount: '1000000' })]);
    expect(result).toHaveLength(0);
  });

  it('drops requirement when no mechanism is registered', async () => {
    const client = new X402Client();
    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement()]);
    expect(result).toHaveLength(0);
  });

  it('keeps requirement when mechanism.checkBalance throws', async () => {
    const client = new X402Client();
    const mechanism = makeMechanism({
      checkBalance: vi.fn().mockRejectedValue(new Error('network error')),
    });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement()]);
    expect(result).toHaveLength(1);
  });

  it('falls back to signer.checkBalance when mechanism has no checkBalance', async () => {
    const client = new X402Client();
    const signer = makeSigner(5000000n);
    const mechanism = makeMechanism({ signer });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement({ amount: '1000000' })]);
    expect(result).toHaveLength(1);
    expect(signer.checkBalance).toHaveBeenCalled();
  });

  it('keeps requirement when fallback signer.checkBalance throws', async () => {
    const client = new X402Client();
    const signer = makeSigner(0n);
    (signer.checkBalance as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
    const mechanism = makeMechanism({ signer });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement()]);
    expect(result).toHaveLength(1);
  });

  it('keeps requirement when no checkBalance and no signer (cannot determine balance)', async () => {
    const client = new X402Client();
    const mechanism = makeMechanism({});
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([makeRequirement()]);
    // No checkBalance, no signer → kept (cannot determine balance)
    expect(result).toHaveLength(1);
  });

  it('returns empty array when all requirements are unaffordable', async () => {
    const client = new X402Client();
    const mechanism = makeMechanism({
      checkBalance: vi.fn().mockResolvedValue(0n),
    });
    client.register('tron:*', mechanism);

    const policy = new SufficientBalancePolicy(client);
    const result = await policy.apply([
      makeRequirement({ amount: '1000000' }),
      makeRequirement({ amount: '2000000' }),
    ]);
    expect(result).toHaveLength(0);
  });
});
