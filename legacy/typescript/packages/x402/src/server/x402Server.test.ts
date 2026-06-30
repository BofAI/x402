/**
 * Tests for the high-level X402Server orchestration.
 */

import { describe, expect, it, vi } from 'vitest';

import type { FacilitatorClient } from '../facilitator/client.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import { DefaultServerMechanism, X402Server } from './x402Server.js';
import type { ResourceConfig, ServerMechanism } from './types.js';

function fakeFacilitator(opts: {
  verify?: VerifyResponse;
  settle?: SettleResponse;
  feeQuotes?: FeeQuoteResponse[];
  facilitatorId?: string;
} = {}): FacilitatorClient {
  return {
    facilitatorId: opts.facilitatorId ?? 'fac-test',
    verify: vi.fn(async () => opts.verify ?? { isValid: true }),
    settle: vi.fn(async () => opts.settle ?? { success: true, transaction: '0xtx' }),
    feeQuote: vi.fn(async () => opts.feeQuotes ?? []),
  } as unknown as FacilitatorClient;
}

describe('X402Server.buildPaymentRequirements', () => {
  it('parses price strings into smallest-unit amounts', async () => {
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());

    const reqs = await server.buildPaymentRequirements([
      {
        scheme: 'exact',
        network: 'tron:mainnet',
        price: '1 USDT',
        payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      },
    ]);

    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.amount).toBe('1000000');
    expect(reqs[0]!.asset).toBe('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t');
    expect(reqs[0]!.maxTimeoutSeconds).toBe(3600);
  });

  it('respects validFor override', async () => {
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const reqs = await server.buildPaymentRequirements([
      {
        scheme: 'exact',
        network: 'tron:mainnet',
        price: '1 USDT',
        payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
        validFor: 60,
      },
    ]);
    expect(reqs[0]!.maxTimeoutSeconds).toBe(60);
  });

  it('throws when no mechanism registered for (network, scheme)', async () => {
    const server = new X402Server().setFacilitator(fakeFacilitator());
    const cfg: ResourceConfig = {
      scheme: 'exact',
      network: 'tron:mainnet',
      price: '1 USDT',
      payTo: 'T...',
    };
    await expect(server.buildPaymentRequirements([cfg])).rejects.toThrow(
      /No ServerMechanism registered/,
    );
  });

  it('throws when facilitator is not set', async () => {
    const server = new X402Server().register(
      'tron:mainnet',
      new DefaultServerMechanism('exact'),
    );
    await expect(
      server.buildPaymentRequirements([
        {
          scheme: 'exact',
          network: 'tron:mainnet',
          price: '1 USDT',
          payTo: 'T...',
        },
      ]),
    ).rejects.toThrow(/Facilitator is not set/);
  });

  it('skips fee_quote for exact scheme (no facilitator fee needed)', async () => {
    const facilitator = fakeFacilitator();
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(facilitator);

    await server.buildPaymentRequirements([
      {
        scheme: 'exact',
        network: 'tron:mainnet',
        price: '1 USDT',
        payTo: 'T...',
      },
    ]);

    expect(facilitator.feeQuote).not.toHaveBeenCalled();
  });

  it('enriches permit-style requirements with facilitator fee', async () => {
    const facilitator = fakeFacilitator({
      feeQuotes: [
        {
          fee: { feeTo: 'TFee...', feeAmount: '100000' },
          pricing: 'fixed',
          scheme: 'exact_permit',
          network: 'tron:mainnet',
          asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        },
      ],
      facilitatorId: 'fac-1',
    });
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact_permit'))
      .setFacilitator(facilitator);

    const reqs = await server.buildPaymentRequirements([
      {
        scheme: 'exact_permit',
        network: 'tron:mainnet',
        price: '1 USDT',
        payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      },
    ]);

    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.extra?.fee).toMatchObject({
      feeTo: 'TFee...',
      feeAmount: '100000',
      facilitatorId: 'fac-1',
    });
  });

  it('drops permit requirements the facilitator cannot quote', async () => {
    const facilitator = fakeFacilitator({ feeQuotes: [] });
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact_permit'))
      .setFacilitator(facilitator);

    const reqs = await server.buildPaymentRequirements([
      {
        scheme: 'exact_permit',
        network: 'tron:mainnet',
        price: '1 USDT',
        payTo: 'T...',
      },
    ]);
    expect(reqs).toHaveLength(0);
  });
});

describe('X402Server.createPaymentRequiredResponse', () => {
  it('emits x402Version=2 and paymentPermitContext meta', () => {
    const server = new X402Server();
    const reqs: PaymentRequirements[] = [
      {
        scheme: 'exact_permit',
        network: 'tron:mainnet',
        amount: '1000000',
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        payTo: 'TJWdoJ...',
      },
    ];
    const response = server.createPaymentRequiredResponse(reqs);
    expect(response.x402Version).toBe(2);
    expect(response.accepts).toBe(reqs);
    expect(response.extensions?.paymentPermitContext?.meta.paymentId).toMatch(/^0x[0-9a-f]{32}$/);
    expect(response.extensions?.paymentPermitContext?.meta.kind).toBe('PAYMENT_ONLY');
  });

  it('respects user-supplied paymentId / validity window', () => {
    const server = new X402Server();
    const response = server.createPaymentRequiredResponse([], {
      paymentId: '0x' + 'aa'.repeat(16),
      validAfter: 1700000000,
      validBefore: 1700003600,
    });
    expect(response.extensions?.paymentPermitContext?.meta).toMatchObject({
      paymentId: '0x' + 'aa'.repeat(16),
      validAfter: 1700000000,
      validBefore: 1700003600,
    });
  });
});

describe('X402Server.verifyPayment / settlePayment', () => {
  const baseReq: PaymentRequirements = {
    scheme: 'exact_permit',
    network: 'tron:mainnet',
    amount: '1000000',
    asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
  };

  function makePayload(): PaymentPayload {
    return {
      x402Version: 2,
      accepted: baseReq,
      payload: {
        signature: '0x' + 'aa'.repeat(65),
        paymentPermit: {
          meta: {
            kind: 'PAYMENT_ONLY',
            paymentId: '0x' + '11'.repeat(16),
            nonce: '0',
            validAfter: 0,
            validBefore: 9_999_999_999,
          },
          buyer: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
          caller: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
          payment: {
            payToken: baseReq.asset,
            payAmount: baseReq.amount,
            payTo: baseReq.payTo,
          },
          fee: { feeTo: 'TFee', feeAmount: '0' },
        },
      },
    } as PaymentPayload;
  }

  it('verifyPayment delegates to facilitator after anti-tamper passes', async () => {
    const facilitator = fakeFacilitator({ verify: { isValid: true } });
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact_permit'))
      .setFacilitator(facilitator);

    const result = await server.verifyPayment(makePayload(), baseReq);
    expect(result.isValid).toBe(true);
    expect(facilitator.verify).toHaveBeenCalledOnce();
  });

  it('verifyPayment rejects payload_mismatch when asset is wrong', async () => {
    const facilitator = fakeFacilitator();
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact_permit'))
      .setFacilitator(facilitator);

    const payload = makePayload();
    payload.payload.paymentPermit!.payment.payToken = 'WRONG_ASSET';

    const result = await server.verifyPayment(payload, baseReq);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('payload_mismatch');
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it('verifyPayment returns no_facilitator when facilitator unset', async () => {
    const server = new X402Server().register(
      'tron:mainnet',
      new DefaultServerMechanism('exact_permit'),
    );
    const result = await server.verifyPayment(makePayload(), baseReq);
    expect(result).toEqual({ isValid: false, invalidReason: 'no_facilitator' });
  });

  it('verifyPayment runs mechanism.verifySignature when present', async () => {
    const verifySignature = vi.fn(async () => false);
    const base = new DefaultServerMechanism('exact_permit');
    const customMech: ServerMechanism = {
      scheme: () => base.scheme(),
      parsePrice: (p, n) => base.parsePrice(p, n),
      enhancePaymentRequirements: (r, d) => base.enhancePaymentRequirements(r, d),
      validatePaymentRequirements: (r) => base.validatePaymentRequirements(r),
      verifySignature,
    };
    const server = new X402Server()
      .register('tron:mainnet', customMech)
      .setFacilitator(fakeFacilitator());

    const result = await server.verifyPayment(makePayload(), baseReq);
    expect(result).toEqual({ isValid: false, invalidReason: 'invalid_signature_server' });
    expect(verifySignature).toHaveBeenCalledOnce();
  });

  it('settlePayment returns no_facilitator without facilitator', async () => {
    const server = new X402Server();
    const result = await server.settlePayment(makePayload(), baseReq);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe('no_facilitator');
    expect(result.network).toBe('tron:mainnet');
  });

  it('settlePayment delegates to facilitator', async () => {
    const facilitator = fakeFacilitator({
      settle: { success: true, transaction: '0xabc', network: 'tron:mainnet' },
    });
    const server = new X402Server().setFacilitator(facilitator);
    const result = await server.settlePayment(makePayload(), baseReq);
    expect(result.success).toBe(true);
    expect(result.transaction).toBe('0xabc');
  });
});

describe('X402Server anti-tamper for exact scheme', () => {
  const exactReq: PaymentRequirements = {
    scheme: 'exact',
    network: 'tron:mainnet',
    amount: '1000000',
    asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
  };

  function exactPayload(overrides: Partial<NonNullable<PaymentPayload['payload']['authorization']>> = {}): PaymentPayload {
    const now = Math.floor(Date.now() / 1000);
    return {
      x402Version: 2,
      accepted: exactReq,
      payload: {
        signature: '0x' + 'aa'.repeat(65),
        authorization: {
          from: 'TFrom',
          to: exactReq.payTo,
          value: exactReq.amount,
          validAfter: String(now - 10),
          validBefore: String(now + 600),
          nonce: '0x' + '11'.repeat(32),
          ...overrides,
        },
      },
    } as PaymentPayload;
  }

  it('passes valid exact authorization', async () => {
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const result = await server.verifyPayment(exactPayload(), exactReq);
    expect(result.isValid).toBe(true);
  });

  it('rejects when authorization value < amount', async () => {
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const result = await server.verifyPayment(exactPayload({ value: '500000' }), exactReq);
    expect(result.invalidReason).toBe('payload_mismatch');
  });

  it('rejects when authorization.to !== payTo', async () => {
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const result = await server.verifyPayment(exactPayload({ to: 'TWrong' }), exactReq);
    expect(result.invalidReason).toBe('payload_mismatch');
  });

  it('rejects expired authorization (validBefore < now)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const result = await server.verifyPayment(
      exactPayload({ validBefore: String(now - 60) }),
      exactReq,
    );
    expect(result.invalidReason).toBe('payload_mismatch');
  });

  it('rejects not-yet-valid authorization (validAfter > now)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const server = new X402Server()
      .register('tron:mainnet', new DefaultServerMechanism('exact'))
      .setFacilitator(fakeFacilitator());
    const result = await server.verifyPayment(
      exactPayload({ validAfter: String(now + 600) }),
      exactReq,
    );
    expect(result.invalidReason).toBe('payload_mismatch');
  });
});
