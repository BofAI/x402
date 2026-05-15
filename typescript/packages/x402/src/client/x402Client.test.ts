import { describe, expect, it } from 'vitest';

import { X402Client, type ClientMechanism } from './x402Client.js';
import type { PaymentPayload, PaymentRequirements } from '../types/index.js';

class MockMechanism implements ClientMechanism {
  scheme(): string {
    return 'exact_permit';
  }

  async createPaymentPayload(
    requirements: PaymentRequirements,
    _resource: string,
  ): Promise<PaymentPayload> {
    return {
      x402Version: 2,
      accepted: requirements,
      payload: { signature: '0x' },
    };
  }
}

function requirement(amount: string): PaymentRequirements {
  return {
    scheme: 'exact_permit',
    network: 'tron:nile',
    amount,
    asset: 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    payTo: 'TT8rEWbCoNX7vpEUauxb7rWJsTgs8vDLAn',
  };
}

describe('X402Client', () => {
  it('awaits async token selection strategies', async () => {
    const client = new X402Client({
      tokenStrategy: {
        async select(accepts) {
          return accepts[1]!;
        },
      },
    }).register('tron:*', new MockMechanism());

    const selected = await client.selectPaymentRequirements([
      requirement('2000000'),
      requirement('1000000'),
    ]);

    expect(selected.amount).toBe('1000000');
  });
});
