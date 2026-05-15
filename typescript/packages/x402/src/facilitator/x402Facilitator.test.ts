/**
 * Tests for X402Facilitator — the in-process payment processor.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../types/index.js';
import {
  X402Facilitator,
  type FacilitatorLogger,
  type FacilitatorMechanism,
} from './x402Facilitator.js';

function makeMechanism(opts: {
  scheme?: string;
  verifyResult?: VerifyResponse;
  settleResult?: SettleResponse;
  quoteResult?: FeeQuoteResponse | null;
  verifyImpl?: () => Promise<VerifyResponse>;
  settleImpl?: () => Promise<SettleResponse>;
  quoteImpl?: () => Promise<FeeQuoteResponse | null>;
} = {}): FacilitatorMechanism {
  return {
    scheme: () => opts.scheme ?? 'exact',
    feeQuote: opts.quoteImpl
      ? vi.fn(opts.quoteImpl)
      : vi.fn(async () => opts.quoteResult ?? null),
    verify: opts.verifyImpl
      ? vi.fn(opts.verifyImpl)
      : vi.fn(async () => opts.verifyResult ?? { isValid: true }),
    settle: opts.settleImpl
      ? vi.fn(opts.settleImpl)
      : vi.fn(async () => opts.settleResult ?? { success: true, transaction: '0xtx' }),
  };
}

const TRON_REQ: PaymentRequirements = {
  scheme: 'exact',
  network: 'tron:nile',
  amount: '1000000',
  asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
};

// EVM addresses purposely lowercase so checksum normalization has work to do.
const EVM_REQ: PaymentRequirements = {
  scheme: 'exact_permit',
  network: 'eip155:97',
  amount: '1000000',
  asset: '0x64544969ed7ebf5f083679233325356ebe738930',
  payTo: '0x1825bb32db3443dec2cc7508b2d818fc13ead878',
};

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: TRON_REQ,
  payload: { signature: '0x' + 'aa'.repeat(65) },
};

describe('X402Facilitator', () => {
  describe('register / supported', () => {
    it('registers a mechanism for multiple networks', () => {
      const facilitator = new X402Facilitator();
      const mech = makeMechanism({ scheme: 'exact' });

      const result = facilitator.register(['tron:nile', 'tron:shasta'], mech);

      expect(result).toBe(facilitator); // chainable
      expect(facilitator.supported().kinds).toEqual([
        { x402Version: 2, scheme: 'exact', network: 'tron:nile' },
        { x402Version: 2, scheme: 'exact', network: 'tron:shasta' },
      ]);
    });

    it('supports multiple schemes per network', () => {
      const facilitator = new X402Facilitator()
        .register(['tron:nile'], makeMechanism({ scheme: 'exact' }))
        .register(['tron:nile'], makeMechanism({ scheme: 'exact_permit' }));

      const kinds = facilitator.supported().kinds;
      expect(kinds).toHaveLength(2);
      expect(kinds.map((k) => k.scheme).sort()).toEqual(['exact', 'exact_permit']);
    });
  });

  describe('verify', () => {
    it('routes to the registered mechanism and forwards its response', async () => {
      const verify = vi.fn(async () => ({ isValid: true }));
      const mech: FacilitatorMechanism = {
        scheme: () => 'exact',
        feeQuote: vi.fn(),
        verify,
        settle: vi.fn(),
      };
      const facilitator = new X402Facilitator().register(['tron:nile'], mech);

      const result = await facilitator.verify(PAYLOAD, TRON_REQ);

      expect(result).toEqual({ isValid: true });
      expect(verify).toHaveBeenCalledOnce();
    });

    it('returns isValid:false with unsupported_network_scheme when no mechanism', async () => {
      const facilitator = new X402Facilitator();
      const result = await facilitator.verify(PAYLOAD, TRON_REQ);
      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain('unsupported_network_scheme');
    });

    it('catches mechanism exceptions and surfaces them as invalidReason', async () => {
      const errorLogger: FacilitatorLogger = { warn: vi.fn(), error: vi.fn() };
      const facilitator = new X402Facilitator({ logger: errorLogger }).register(
        ['tron:nile'],
        makeMechanism({
          verifyImpl: async () => {
            throw new Error('signature mismatch');
          },
        }),
      );

      const result = await facilitator.verify(PAYLOAD, TRON_REQ);

      expect(result).toEqual({ isValid: false, invalidReason: 'signature mismatch' });
      expect(errorLogger.error).toHaveBeenCalledOnce();
    });

    it('checksums EVM addresses before passing to mechanism', async () => {
      const verify = vi.fn(async () => ({ isValid: true }));
      const mech: FacilitatorMechanism = {
        scheme: () => 'exact_permit',
        feeQuote: vi.fn(),
        verify,
        settle: vi.fn(),
      };
      const facilitator = new X402Facilitator().register(['eip155:97'], mech);

      await facilitator.verify(PAYLOAD, EVM_REQ);

      const passed = (verify as ReturnType<typeof vi.fn>).mock.calls[0]![1] as PaymentRequirements;
      // Checksummed = mixed case
      expect(passed.asset).not.toBe(EVM_REQ.asset);
      expect(passed.asset.toLowerCase()).toBe(EVM_REQ.asset);
      expect(passed.payTo).not.toBe(EVM_REQ.payTo);
    });

    it('returns isValid:false on invalid EVM address (no exception thrown)', async () => {
      const facilitator = new X402Facilitator().register(
        ['eip155:97'],
        makeMechanism({ scheme: 'exact_permit' }),
      );

      const result = await facilitator.verify(PAYLOAD, {
        ...EVM_REQ,
        asset: '0xnot_an_address',
      });

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toContain('Invalid EVM address');
    });
  });

  describe('settle', () => {
    it('routes to mechanism and returns its response', async () => {
      const facilitator = new X402Facilitator().register(
        ['tron:nile'],
        makeMechanism({
          settleResult: { success: true, transaction: '0xabc', network: 'tron:nile' },
        }),
      );

      const result = await facilitator.settle(PAYLOAD, TRON_REQ);

      expect(result).toEqual({ success: true, transaction: '0xabc', network: 'tron:nile' });
    });

    it('returns success:false with unsupported_network_scheme on miss', async () => {
      const facilitator = new X402Facilitator();
      const result = await facilitator.settle(PAYLOAD, TRON_REQ);
      expect(result.success).toBe(false);
      expect(result.network).toBe('tron:nile');
      expect(result.errorReason).toContain('unsupported_network_scheme');
    });

    it('catches mechanism exceptions into errorReason', async () => {
      const facilitator = new X402Facilitator({ logger: { warn: vi.fn(), error: vi.fn() } })
        .register(
          ['tron:nile'],
          makeMechanism({
            settleImpl: async () => {
              throw new Error('chain rpc down');
            },
          }),
        );

      const result = await facilitator.settle(PAYLOAD, TRON_REQ);
      expect(result).toEqual({
        success: false,
        network: 'tron:nile',
        errorReason: 'chain rpc down',
      });
    });
  });

  describe('feeQuote', () => {
    it('aggregates quotes from registered mechanisms, skips misses', async () => {
      const facilitator = new X402Facilitator().register(
        ['tron:nile'],
        makeMechanism({
          quoteResult: {
            fee: { feeTo: 'TFee', feeAmount: '0' },
            pricing: 'fixed',
            scheme: 'exact',
            network: 'tron:nile',
            asset: TRON_REQ.asset,
          },
        }),
      );

      const supported = TRON_REQ;
      const unsupported: PaymentRequirements = {
        ...TRON_REQ,
        network: 'eip155:1',
        scheme: 'unknown',
      };

      const quotes = await facilitator.feeQuote([supported, unsupported]);
      expect(quotes).toHaveLength(1);
      expect(quotes[0]!.network).toBe('tron:nile');
    });

    it('forwards optional context to mechanism', async () => {
      const quoteFn = vi.fn(async () => null);
      const mech: FacilitatorMechanism = {
        scheme: () => 'exact',
        feeQuote: quoteFn,
        verify: vi.fn(),
        settle: vi.fn(),
      };
      const facilitator = new X402Facilitator().register(['tron:nile'], mech);

      await facilitator.feeQuote([TRON_REQ], { paymentId: '0x123' });

      expect(quoteFn).toHaveBeenCalledWith(expect.anything(), { paymentId: '0x123' });
    });

    it('drops null quotes from result', async () => {
      const facilitator = new X402Facilitator().register(
        ['tron:nile'],
        makeMechanism({ quoteResult: null }),
      );

      const quotes = await facilitator.feeQuote([TRON_REQ]);
      expect(quotes).toHaveLength(0);
    });

    it('throws when mechanism feeQuote raises', async () => {
      const facilitator = new X402Facilitator().register(
        ['tron:nile'],
        makeMechanism({
          quoteImpl: async () => {
            throw new Error('quote oracle down');
          },
        }),
      );

      await expect(facilitator.feeQuote([TRON_REQ])).rejects.toThrow(
        /Fee quote failed for tron:nile\/exact: quote oracle down/,
      );
    });
  });
});
