import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExactGasFreeClientMechanism } from './client.js';
import { GasFreeAPIClient } from '../../../utils/gasfree.js';
import { PaymentRequirements, ClientSigner } from '../../../index.js';

const assembleGasFreeTransactionJson = vi.fn((params: any) => ({
  domain: {
    name: 'GasFreeController',
    version: 'V1.0.0',
    chainId: 1,
    verifyingContract: params.serviceProvider,
  },
  types: {
    PermitTransfer: [],
  },
  message: {
    token: params.token,
    serviceProvider: params.serviceProvider,
    user: params.user,
    receiver: params.receiver,
    value: params.value,
    maxFee: params.maxFee,
    deadline: params.deadline,
    version: params.version,
    nonce: params.nonce,
  },
}));

vi.mock('@gasfree/gasfree-sdk', () => {
  return {
    default: {
      TronGasFree: class {
        assembleGasFreeTransactionJson(params: any) {
          return assembleGasFreeTransactionJson(params);
        }
      },
    },
  };
});

vi.mock('../../../utils/gasfree.js', () => {
  return {
    GasFreeAPIClient: vi.fn().mockImplementation(() => {
      return {
        getAddressInfo: vi.fn().mockResolvedValue({
          accountAddress: 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC',
          gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
          active: true,
          nonce: 1,
          assets: [
            {
              tokenAddress: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
              balance: '5000000',
              transferFee: '1000000',
            },
          ],
        }),
        getProviders: vi.fn().mockResolvedValue([
          { address: 'TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E' }
        ]),
      };
    }),
  };
});


describe('ExactGasFreeClientMechanism', () => {
  const USDT_ADDRESS = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
  const MOCK_ADDR = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
  let mockSigner: any;
  let mechanism: ExactGasFreeClientMechanism;
  let mockApiClient: any;

  beforeEach(() => {
    assembleGasFreeTransactionJson.mockClear();
    mockApiClient = new GasFreeAPIClient('url');
    mockSigner = {
      getAddress: vi.fn().mockReturnValue(MOCK_ADDR),
      signTypedData: vi.fn().mockResolvedValue('0x' + 'ab'.repeat(65)),
      checkBalance: vi.fn().mockResolvedValue(5000000n),
    };
    mechanism = new ExactGasFreeClientMechanism(mockSigner as unknown as ClientSigner, { "tron:nile": mockApiClient });
  });

  it('should create a valid payment payload', async () => {
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeTo: MOCK_ADDR,
          feeAmount: '0',
        },
      },
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    expect(payload.x402Version).toBe(2);
    expect(payload.payload.signature).toBe('0x' + 'ab'.repeat(65));
    expect(payload.extensions?.gasfreeAddress).toBe('TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC');

    const [domain, _types, message] = mockSigner.signTypedData.mock.calls[0];
    expect(domain.verifyingContract).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(message.token).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(message.serviceProvider).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(message.user).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(message.receiver).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('should adjust maxFee to protocol minimum', async () => {
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '100000', // 0.1 USDT
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');
    
    // Should be adjusted to 1 USDT (1,000,000)
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('1000000');
  });

  it('should fallback to fetch providers when extra.fee is missing', async () => {
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    expect(payload.x402Version).toBe(2);
    expect(mockApiClient.getProviders).toHaveBeenCalled();
  });

  it('should include activateFee in maxFee when account is not activated', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: false,
      allowSubmit: true,
      nonce: 0,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '15000000',
          transferFee: '1000000',
          activateFee: '2050000',
        },
      ],
    });
    mockSigner.checkBalance.mockResolvedValue(15000000n);

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '0',
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // maxFee should be transferFee (1000000) + activateFee (2050000) = 3050000
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('3050000');
  });

  it('should throw when address conversion fails', async () => {
    assembleGasFreeTransactionJson.mockImplementationOnce(() => ({
      domain: {
        name: 'GasFreeController',
        version: 'V1.0.0',
        chainId: 1,
        verifyingContract: 'invalid',
      },
      types: {
        PermitTransfer: [],
      },
      message: {
        token: 'invalid',
        serviceProvider: 'invalid',
        user: 'invalid',
        receiver: 'invalid',
        value: '1',
        maxFee: '1',
        deadline: '1',
        version: '1',
        nonce: '1',
      },
    }));

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeTo: MOCK_ADDR,
          feeAmount: '0',
        },
      },
    };

    await expect(
      mechanism.createPaymentPayload(requirements, 'https://example.com/res')
    ).rejects.toThrow('GasFree TIP-712: could not convert');
  });

  it('should NOT include activateFee when account is already activated', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: true,
      nonce: 1,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '5000000',
          transferFee: '1000000',
          activateFee: '2050000',
        },
      ],
    });

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '0',
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // activateFee should be ignored since account is active
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('1000000');
  });

  it('should handle zero activateFee when not activated', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: false,
      allowSubmit: true,
      nonce: 0,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '5000000',
          transferFee: '1000000',
          activateFee: '0',
        },
      ],
    });

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '0',
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // activateFee is 0 → maxFee stays as transferFee
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('1000000');
  });

  it('should handle missing activateFee field gracefully', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: false,
      allowSubmit: true,
      nonce: 0,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '5000000',
          transferFee: '1000000',
          // activateFee field missing entirely
        },
      ],
    });

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '0',
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // No activateFee → defaults to 0 → maxFee = transferFee only
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('1000000');
  });

  it('should add activateFee on top of higher facilitator fee', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: false,
      allowSubmit: true,
      nonce: 0,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '20000000',
          transferFee: '1000000',
          activateFee: '2050000',
        },
      ],
    });
    mockSigner.checkBalance.mockResolvedValue(20000000n);

    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: {
        fee: {
          feeAmount: '5000000',
          feeTo: MOCK_ADDR,
        }
      }
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // facilitatorFee(5000000) > transferFee(1000000), base = 5000000
    // maxFee = 5000000 + activateFee(2050000) = 7050000
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('7050000');
  });

  it('should add activateFee on top of fallback 1-token minimum', async () => {
    mockApiClient.getAddressInfo.mockResolvedValue({
      accountAddress: MOCK_ADDR,
      gasFreeAddress: 'TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC',
      active: false,
      allowSubmit: true,
      nonce: 0,
      assets: [
        {
          tokenAddress: USDT_ADDRESS,
          balance: '10000000',
          transferFee: '0',
          activateFee: '2050000',
        },
      ],
    });
    mockSigner.checkBalance.mockResolvedValue(10000000n);

    // No extra.fee → triggers fallback to 1 token (1000000)
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
    };

    const payload = await mechanism.createPaymentPayload(requirements, 'https://example.com/res');

    // fallback(1000000) + activateFee(2050000) = 3050000
    expect(payload.payload.paymentPermit?.fee.feeAmount).toBe('3050000');
  });

  it('should throw error if network is not configured', async () => {
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:mainnet',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
    };

    await expect(mechanism.createPaymentPayload(requirements, 'url'))
      .rejects.toThrow('GasFree is not configured for network: tron:mainnet');
  });

  it('should clamp deadline above max for mainnet and nile', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const baseReq: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:mainnet',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: { fee: { feeTo: MOCK_ADDR, feeAmount: '0' } },
    };

    const mainnetClient = new ExactGasFreeClientMechanism(
      mockSigner as unknown as ClientSigner,
      { 'tron:mainnet': mockApiClient }
    );
    const mainnetPayload = await mainnetClient.createPaymentPayload(
      baseReq,
      'https://example.com/res',
      { paymentPermitContext: { meta: { validBefore: now + 2000 } } }
    );
    expect(mainnetPayload.payload.paymentPermit?.meta.validBefore).toBe(now + 595);

    const nileClient = new ExactGasFreeClientMechanism(
      mockSigner as unknown as ClientSigner,
      { 'tron:nile': mockApiClient }
    );
    const nilePayload = await nileClient.createPaymentPayload(
      { ...baseReq, network: 'tron:nile' },
      'https://example.com/res',
      { paymentPermitContext: { meta: { validBefore: now + 5000 } } }
    );
    expect(nilePayload.payload.paymentPermit?.meta.validBefore).toBe(now + 3595);

    vi.useRealTimers();
  });

  it('should throw when deadline is too soon', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-27T00:00:00Z'));
    const now = Math.floor(Date.now() / 1000);
    const requirements: PaymentRequirements = {
      scheme: 'exact_gasfree',
      network: 'tron:nile',
      amount: '1000000',
      asset: USDT_ADDRESS,
      payTo: MOCK_ADDR,
      extra: { fee: { feeTo: MOCK_ADDR, feeAmount: '0' } },
    };

    const client = new ExactGasFreeClientMechanism(
      mockSigner as unknown as ClientSigner,
      { 'tron:nile': mockApiClient }
    );
    await expect(
      client.createPaymentPayload(requirements, 'https://example.com/res', {
        paymentPermitContext: { meta: { validBefore: now + 10 } },
      })
    ).rejects.toThrow('deadline too soon');

    vi.useRealTimers();
  });
});
