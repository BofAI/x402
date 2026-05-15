import { describe, expect, it } from 'vitest';

import { TronAddressConverter } from '../../../address.js';
import { FacilitatorSigner } from '../../../signers/facilitator/base.js';
import type { PaymentPayload, PaymentRequirements } from '../../../types/index.js';
import {
  GasFreeAPIClient,
  type GasFreeProvider,
  type GasFreeSubmitResponseData,
} from '../../../utils/gasfree.js';
import { ExactGasFreeFacilitatorMechanism } from './facilitator.js';

class MockSigner extends FacilitatorSigner {
  public verifiedMessage: Record<string, unknown> | null = null;

  getAddress(): string {
    return 'TFeeAddress';
  }

  async verifyTypedData(
    _address: string,
    _domain: Record<string, unknown>,
    _types: Record<string, ReadonlyArray<{ name: string; type: string }>>,
    message: Record<string, unknown>,
  ): Promise<boolean> {
    this.verifiedMessage = message;
    return true;
  }

  async writeContract(): Promise<string | null> {
    return null;
  }

  async checkBalance(): Promise<bigint> {
    return BigInt(2_000_000);
  }

  async waitForTransactionReceipt() {
    return { hash: '0x', blockNumber: '0', status: 'confirmed' as const };
  }
}

class MockGasFreeClient extends GasFreeAPIClient {
  public submittedMessage: Record<string, unknown> | null = null;

  constructor(private readonly providers: GasFreeProvider[]) {
    super('https://gasfree.test');
  }

  async getProviders(): Promise<GasFreeProvider[]> {
    return this.providers;
  }

  async submit(
    _domain: unknown,
    message: Record<string, unknown>,
    _signature: string,
  ): Promise<string> {
    this.submittedMessage = message;
    return 'trace-123';
  }

  async waitForSuccess(_traceId: string): Promise<GasFreeSubmitResponseData> {
    return {
      id: 'trace-123',
      state: 'SUCCEED',
      createdAt: new Date().toISOString(),
      accountAddress: BUYER,
      gasFreeAddress: GASFREE_ADDRESS,
      providerAddress: PROVIDER,
      targetAddress: PAY_TO,
      nonce: 7,
      tokenAddress: TOKEN,
      amount: '1000000',
      expiredAt: new Date(Date.now() + 60_000).toISOString(),
      txnHash: 'tron-tx-hash',
      txnState: 'ON_CHAIN',
    };
  }
}

const TOKEN = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';
const PROVIDER = 'TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC';
const BUYER = 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx';
const PAY_TO = 'TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn';
const GASFREE_ADDRESS = 'TQghdCeVDA6CnuNVTUhfaAyPfTetqZWNpm';

const provider: GasFreeProvider = {
  address: PROVIDER,
  name: 'Provider',
  icon: '',
  website: '',
  config: {
    maxPendingTransfer: 10,
    minDeadlineDuration: 60,
    maxDeadlineDuration: 3600,
    defaultDeadlineDuration: 600,
  },
};

function makeRequirements(): PaymentRequirements {
  return {
    scheme: 'exact_gasfree',
    network: 'tron:nile',
    amount: '1000000',
    asset: TOKEN,
    payTo: PAY_TO,
  };
}

function makePayload(): PaymentPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    x402Version: 2,
    accepted: makeRequirements(),
    payload: {
      signature: '0x' + '11'.repeat(65),
      paymentPermit: {
        meta: {
          kind: 'PAYMENT_ONLY',
          paymentId: '0x' + '12'.repeat(16),
          nonce: '7',
          validAfter: 0,
          validBefore: now + 600,
        },
        buyer: BUYER,
        caller: PROVIDER,
        payment: {
          payToken: TOKEN,
          payAmount: '1000000',
          payTo: PAY_TO,
        },
        fee: {
          feeTo: PROVIDER,
          feeAmount: '100000',
        },
      },
    },
    extensions: { gasfreeAddress: GASFREE_ADDRESS },
  };
}

function makeMechanism(client: MockGasFreeClient, signer = new MockSigner()) {
  return {
    signer,
    mechanism: new ExactGasFreeFacilitatorMechanism(signer, {
      clients: { 'tron:nile': client },
      baseFee: { USDT: '100000' },
    }),
  };
}

describe('ExactGasFreeFacilitatorMechanism', () => {
  it('returns provider-backed flat fee quotes', async () => {
    const client = new MockGasFreeClient([provider]);
    const { mechanism } = makeMechanism(client);

    const quote = await mechanism.feeQuote(makeRequirements());

    expect(quote?.fee).toMatchObject({
      feeTo: PROVIDER,
      feeAmount: '100000',
      caller: PROVIDER,
    });
    expect(quote?.pricing).toBe('flat');
  });

  it('verifies GasFree permits with TIP-712 fields', async () => {
    const client = new MockGasFreeClient([provider]);
    const { mechanism, signer } = makeMechanism(client);

    const result = await mechanism.verify(makePayload(), makeRequirements());

    expect(result).toEqual({ isValid: true });
    expect(signer.verifiedMessage).toMatchObject({
      value: BigInt(1000000),
      maxFee: BigInt(100000),
      nonce: BigInt(7),
      version: BigInt(1),
    });
  });

  it('settles through GasFree API and returns the TRON transaction hash', async () => {
    const client = new MockGasFreeClient([provider]);
    const { mechanism } = makeMechanism(client);
    const converter = new TronAddressConverter();
    const payload = makePayload();
    const nonce = '150059107766486682482117853208163347732';
    payload.payload.paymentPermit!.meta.nonce = nonce;

    const result = await mechanism.settle(payload, makeRequirements());

    expect(result).toEqual({
      success: true,
      transaction: 'tron-tx-hash',
      network: 'tron:nile',
    });
    expect(client.submittedMessage).toMatchObject({
      token: converter.toEvmFormat(TOKEN),
      serviceProvider: converter.toEvmFormat(PROVIDER),
      user: converter.toEvmFormat(BUYER),
      receiver: converter.toEvmFormat(PAY_TO),
      value: BigInt(1000000),
      maxFee: BigInt(100000),
      nonce: BigInt(nonce),
    });
  });

  it('rejects not-yet-valid GasFree permits', async () => {
    const client = new MockGasFreeClient([provider]);
    const { mechanism } = makeMechanism(client);
    const payload = makePayload();
    payload.payload.paymentPermit!.meta.validAfter = Math.floor(Date.now() / 1000) + 600;

    const result = await mechanism.verify(payload, makeRequirements());

    expect(result).toEqual({ isValid: false, invalidReason: 'not_yet_valid' });
  });
});
