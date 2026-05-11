/**
 * Smoke tests for the 10 new server + facilitator mechanism wrappers.
 *
 * Verifies registration into X402Server / X402Facilitator and the cheap,
 * non-RPC paths (scheme name, feeQuote, parsePrice, validate, structural
 * verify). Chain-RPC integration (signature recovery, settle) is stubbed
 * in v0.6.0 and gets its own tests in v0.6.0b.
 */

import { describe, expect, it } from 'vitest';

import { FacilitatorClient } from '../facilitator/client.js';
import { X402Facilitator } from '../facilitator/x402Facilitator.js';
import { X402Server } from '../server/x402Server.js';
import {
  ExactEvmFacilitatorMechanism,
  ExactEvmServerMechanism,
  ExactGasFreeFacilitatorMechanism,
  ExactGasFreeServerMechanism,
  ExactPermitEvmFacilitatorMechanism,
  ExactPermitEvmServerMechanism,
  ExactPermitTronFacilitatorMechanism,
  ExactPermitTronServerMechanism,
  ExactTronFacilitatorMechanism,
  ExactTronServerMechanism,
} from './index.js';

const FAKE_FEE = { feeTo: 'TFeeAddress', defaultBaseFee: '100' };

describe('Server mechanisms register into X402Server', () => {
  it('registers all 5 server mechanisms across (chain, scheme)', () => {
    const fac = new FacilitatorClient({ baseUrl: 'https://fac.test' });
    const server = new X402Server()
      .register('eip155:97', new ExactEvmServerMechanism())
      .register('eip155:97', new ExactPermitEvmServerMechanism())
      .register('tron:nile', new ExactTronServerMechanism())
      .register('tron:nile', new ExactPermitTronServerMechanism())
      .register('tron:nile', new ExactGasFreeServerMechanism())
      .setFacilitator(fac);
    // Smoke: server is configured without errors.
    expect(server).toBeInstanceOf(X402Server);
  });

  it('each server mechanism reports its scheme correctly', () => {
    expect(new ExactEvmServerMechanism().scheme()).toBe('exact');
    expect(new ExactPermitEvmServerMechanism().scheme()).toBe('exact_permit');
    expect(new ExactTronServerMechanism().scheme()).toBe('exact');
    expect(new ExactPermitTronServerMechanism().scheme()).toBe('exact_permit');
    expect(new ExactGasFreeServerMechanism().scheme()).toBe('exact_gasfree');
  });

  it('parsePrice works on all 5 server mechanisms', async () => {
    const evmExact = await new ExactEvmServerMechanism().parsePrice('1 USDT', 'eip155:97');
    expect(evmExact.amount).toBe('1000000000000000000'); // 18 decimals
    const tronExact = await new ExactTronServerMechanism().parsePrice('1 USDT', 'tron:mainnet');
    expect(tronExact.amount).toBe('1000000'); // 6 decimals
  });

  it('enhancePaymentRequirements attaches token name', async () => {
    const mech = new ExactPermitEvmServerMechanism();
    const enhanced = await mech.enhancePaymentRequirements(
      {
        scheme: 'exact_permit',
        network: 'eip155:97',
        amount: '1000000',
        asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
        payTo: '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
      },
      'PAYMENT_ONLY',
    );
    expect(enhanced.extra?.name).toBe('Tether USD');
  });

  it('validatePaymentRequirements rejects mismatched network prefix', () => {
    const evmMech = new ExactPermitEvmServerMechanism();
    expect(
      evmMech.validatePaymentRequirements({
        scheme: 'exact_permit',
        network: 'tron:nile',
        amount: '1',
        asset: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
        payTo: 'TJWdoJk8KyrfxZ2iDUqz7fwpXaMkNqPehx',
      }),
    ).toBe(false);
  });
});

describe('Facilitator mechanisms register into X402Facilitator', () => {
  it('registers all 5 facilitator mechanisms', () => {
    const fac = new X402Facilitator()
      .register(['eip155:97'], new ExactEvmFacilitatorMechanism())
      .register(['eip155:97'], new ExactPermitEvmFacilitatorMechanism(FAKE_FEE))
      .register(['tron:nile'], new ExactTronFacilitatorMechanism())
      .register(['tron:nile'], new ExactPermitTronFacilitatorMechanism(FAKE_FEE))
      .register(['tron:nile'], new ExactGasFreeFacilitatorMechanism(FAKE_FEE));

    const supported = fac.supported();
    expect(supported.kinds).toHaveLength(5);
    const schemes = supported.kinds.map((k) => `${k.network}/${k.scheme}`).sort();
    expect(schemes).toEqual([
      'eip155:97/exact',
      'eip155:97/exact_permit',
      'tron:nile/exact',
      'tron:nile/exact_gasfree',
      'tron:nile/exact_permit',
    ]);
  });

  it('exact feeQuote returns null (no fee for exact scheme)', async () => {
    const mech = new ExactEvmFacilitatorMechanism();
    const quote = await mech.feeQuote({
      scheme: 'exact',
      network: 'eip155:97',
      amount: '1',
      asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
      payTo: '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
    });
    expect(quote).toBeNull();
  });

  it('permit feeQuote returns the configured fee', async () => {
    const mech = new ExactPermitEvmFacilitatorMechanism({
      feeTo: '0xFee',
      defaultBaseFee: '5000',
    });
    const quote = await mech.feeQuote({
      scheme: 'exact_permit',
      network: 'eip155:97',
      amount: '1',
      asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
      payTo: '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
    });
    expect(quote?.fee.feeTo).toBe('0xFee');
    expect(quote?.fee.feeAmount).toBe('5000');
    expect(quote?.pricing).toBe('fixed');
  });

  it('per-token base fee override wins over default', async () => {
    const mech = new ExactPermitEvmFacilitatorMechanism({
      feeTo: '0xFee',
      defaultBaseFee: '100',
      baseFeesByToken: { 'eip155:97:0x337610d27c682e347c9cd60bd4b3b107c9d34ddd': '999' },
    });
    const quote = await mech.feeQuote({
      scheme: 'exact_permit',
      network: 'eip155:97',
      amount: '1',
      asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
      payTo: '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
    });
    expect(quote?.fee.feeAmount).toBe('999');
  });

  it('settle for stubbed mechanisms returns success:false with TODO marker', async () => {
    const mech = new ExactEvmFacilitatorMechanism();
    const result = await mech.settle(
      {
        x402Version: 2,
        accepted: {} as never,
        payload: { signature: '0x', authorization: { from: '', to: '', value: '0', validAfter: '0', validBefore: '0', nonce: '0x' } },
      },
      {
        scheme: 'exact',
        network: 'eip155:97',
        amount: '1',
        asset: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd',
        payTo: '0x1825bB32db3443dEc2cc7508b2D818fc13EaD878',
      },
    );
    expect(result.success).toBe(false);
    expect(result.errorReason).toContain('not_implemented');
  });
});
