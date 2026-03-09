import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExactGasFreeClientMechanism } from './exactGasfree.js';
import { GasFreeAPIClient } from '../utils/gasfree.js';
import { PaymentRequirements, ClientSigner } from '../index.js';

vi.mock('../utils/gasfree.js', () => {
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
});
