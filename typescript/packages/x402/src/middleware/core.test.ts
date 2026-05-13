/**
 * Tests for the framework-agnostic middleware core.
 */

import { describe, expect, it, vi } from 'vitest';

import type { FacilitatorClient } from '../facilitator/client.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import { decodePaymentPayload, encodePaymentPayload } from '../utils/encoding.js';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  processX402Request,
  X402_VERSION,
  type X402MiddlewareConfig,
} from './core.js';

const TRON_REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};

function makeFacilitator(opts: {
  verify?: VerifyResponse | (() => Promise<VerifyResponse>);
  settle?: SettleResponse | (() => Promise<SettleResponse>);
}): FacilitatorClient {
  return {
    verify: vi.fn(async () =>
      typeof opts.verify === 'function'
        ? await opts.verify()
        : (opts.verify ?? { isValid: true }),
    ),
    settle: vi.fn(async () =>
      typeof opts.settle === 'function'
        ? await opts.settle()
        : (opts.settle ?? { success: true, transaction: '0xtx', network: 'tron:nile' }),
    ),
  } as unknown as FacilitatorClient;
}

function makePayload(req: PaymentRequirements): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    accepted: req,
    payload: { signature: '0x' + 'aa'.repeat(65) },
  };
}

describe('processX402Request', () => {
  it('returns 402 + PAYMENT-REQUIRED when no signature header', async () => {
    const config: X402MiddlewareConfig = {
      facilitator: makeFacilitator({}),
      accepts: [TRON_REQ],
    };

    const decision = await processX402Request(null, config);

    expect(decision.kind).toBe('paymentRequired');
    if (decision.kind !== 'paymentRequired') return;
    expect(decision.status).toBe(402);
    expect(decision.headers[PAYMENT_REQUIRED_HEADER]).toBeTypeOf('string');
    expect(decision.paymentRequired.x402Version).toBe(X402_VERSION);
    expect(decision.paymentRequired.accepts).toEqual([TRON_REQ]);

    // Header round-trips back to the same body.
    const decoded = decodePaymentPayload(decision.headers[PAYMENT_REQUIRED_HEADER]!);
    expect(decoded).toEqual(decision.paymentRequired);
  });

  it('echoes resource + extensions when configured', async () => {
    const config: X402MiddlewareConfig = {
      facilitator: makeFacilitator({}),
      accepts: [TRON_REQ],
      resource: { url: 'http://example.com/api', description: 'demo' },
      extensions: { 'payment-identifier': { info: { required: false } } },
      enrich: false, // legacy passthrough; don't generate paymentPermitContext
    };

    const decision = await processX402Request(null, config);
    if (decision.kind !== 'paymentRequired') throw new Error('expected paymentRequired');
    expect(decision.paymentRequired.resource).toEqual(config.resource);
    expect(decision.paymentRequired.extensions).toEqual(config.extensions);
  });

  it('enriches with fresh paymentPermitContext per challenge by default', async () => {
    const config: X402MiddlewareConfig = {
      facilitator: makeFacilitator({}),
      accepts: [TRON_REQ],
    };
    const a = await processX402Request(null, config);
    const b = await processX402Request(null, config);
    if (a.kind !== 'paymentRequired' || b.kind !== 'paymentRequired') {
      throw new Error('expected paymentRequired');
    }
    const ctxA = a.paymentRequired.extensions?.paymentPermitContext as
      | { meta: { paymentId: string; nonce: string } }
      | undefined;
    const ctxB = b.paymentRequired.extensions?.paymentPermitContext as
      | { meta: { paymentId: string; nonce: string } }
      | undefined;
    expect(ctxA?.meta.paymentId).toMatch(/^0x[0-9a-f]{32}$/);
    expect(ctxB?.meta.paymentId).toMatch(/^0x[0-9a-f]{32}$/);
    expect(ctxA?.meta.paymentId).not.toBe(ctxB?.meta.paymentId);
    expect(ctxA?.meta.nonce).not.toBe(ctxB?.meta.nonce);
  });

  it('returns 400 invalid when signature header is unparseable', async () => {
    const config: X402MiddlewareConfig = {
      facilitator: makeFacilitator({}),
      accepts: [TRON_REQ],
    };

    const decision = await processX402Request('not-base64-json', config);

    expect(decision.kind).toBe('invalid');
    if (decision.kind !== 'invalid') return;
    expect(decision.status).toBe(400);
    expect(decision.reason).toMatch(/Invalid payment payload/);
  });

  it("returns 400 invalid when client's accepted entry doesn't match offer", async () => {
    const config: X402MiddlewareConfig = {
      facilitator: makeFacilitator({}),
      accepts: [TRON_REQ],
    };
    const wrongPayload = makePayload({ ...TRON_REQ, network: 'tron:mainnet' });
    const header = encodePaymentPayload(wrongPayload);

    const decision = await processX402Request(header, config);

    expect(decision.kind).toBe('invalid');
    if (decision.kind !== 'invalid') return;
    expect(decision.reason).toMatch(/Unsupported payment/);
  });

  it('returns 500 failed when facilitator.verify rejects', async () => {
    const facilitator = makeFacilitator({
      verify: { isValid: false, invalidReason: 'bad signature' },
    });
    const config: X402MiddlewareConfig = { facilitator, accepts: [TRON_REQ] };
    const header = encodePaymentPayload(makePayload(TRON_REQ));

    const decision = await processX402Request(header, config);

    expect(decision.kind).toBe('failed');
    if (decision.kind !== 'failed') return;
    expect(decision.reason).toBe('bad signature');
  });

  it('returns 500 failed when verify throws', async () => {
    const facilitator = makeFacilitator({
      verify: async () => {
        throw new Error('connection reset');
      },
    });
    const config: X402MiddlewareConfig = { facilitator, accepts: [TRON_REQ] };
    const header = encodePaymentPayload(makePayload(TRON_REQ));

    const decision = await processX402Request(header, config);

    expect(decision.kind).toBe('failed');
    if (decision.kind !== 'failed') return;
    expect(decision.reason).toMatch(/Verify request failed: connection reset/);
  });

  it('returns 500 failed when settle returns success:false', async () => {
    const facilitator = makeFacilitator({
      settle: {
        success: false,
        errorReason: 'insufficient balance',
        transaction: '0xabc',
        network: 'tron:nile',
      },
    });
    const config: X402MiddlewareConfig = { facilitator, accepts: [TRON_REQ] };
    const header = encodePaymentPayload(makePayload(TRON_REQ));

    const decision = await processX402Request(header, config);

    expect(decision.kind).toBe('failed');
    if (decision.kind !== 'failed') return;
    expect(decision.reason).toBe('insufficient balance');
    expect(decision.transaction).toBe('0xabc');
    expect(decision.network).toBe('tron:nile');
  });

  it('returns allow + PAYMENT-RESPONSE on success', async () => {
    const settled: SettleResponse = {
      success: true,
      transaction: '0xdeadbeef',
      network: 'tron:nile',
    };
    const facilitator = makeFacilitator({ settle: settled });
    const config: X402MiddlewareConfig = { facilitator, accepts: [TRON_REQ] };
    const header = encodePaymentPayload(makePayload(TRON_REQ));

    const decision = await processX402Request(header, config);

    expect(decision.kind).toBe('allow');
    if (decision.kind !== 'allow') return;
    expect(decision.settleResult).toEqual(settled);
    const decoded = decodePaymentPayload(decision.headers[PAYMENT_RESPONSE_HEADER]!);
    expect(decoded).toEqual(settled);
  });

  it('matches accepts with case-insensitive asset / payTo comparison', async () => {
    const facilitator = makeFacilitator({});
    const config: X402MiddlewareConfig = {
      facilitator,
      accepts: [TRON_REQ],
    };
    const payload = makePayload({
      ...TRON_REQ,
      asset: TRON_REQ.asset.toUpperCase(),
      payTo: TRON_REQ.payTo.toUpperCase(),
    });

    const decision = await processX402Request(encodePaymentPayload(payload), config);

    expect(decision.kind).toBe('allow');
  });
});
