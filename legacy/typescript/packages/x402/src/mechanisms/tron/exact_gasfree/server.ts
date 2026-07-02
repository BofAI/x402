import { findByAddress, parsePrice } from '../../../tokens.js';
import type { ServerMechanism } from '../../../server/types.js';
import type {
  PaymentPermit,
  PaymentRequirements,
} from '../../../types/index.js';

const SCHEME_EXACT_GASFREE = 'exact_gasfree';

/**
 * TRON server mechanism for the `exact_gasfree` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_gasfree.server.ExactGasFreeServerMechanism`.
 * GasFree is TRON-only (no EVM counterpart) so there is no shared
 * `_exact_gasfree_base/`.
 */
export class ExactGasFreeServerMechanism implements ServerMechanism {
  scheme(): string {
    return SCHEME_EXACT_GASFREE;
  }

  async parsePrice(price: string, network: string) {
    return parsePrice(price, network);
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _deliveryMode: string,
  ): Promise<PaymentRequirements> {
    const token = findByAddress(requirements.network, requirements.asset);
    if (!token) return requirements;
    return {
      ...requirements,
      extra: {
        ...(requirements.extra ?? {}),
        name: token.name,
        ...(token.version ? { version: token.version } : {}),
      },
    };
  }

  validatePaymentRequirements(requirements: PaymentRequirements): boolean {
    return requirements.network.startsWith('tron:');
  }

  /**
   * TIP-712 GasFree permit signature recovery.
   *
   * TODO(v0.6.0b): port from Python — TIP-712 hash + signature recovery.
   * Returns `true` for now; facilitator authoritative.
   */
  async verifySignature(
    _permit: PaymentPermit | null | undefined,
    _signature: string,
    _network: string,
  ): Promise<boolean> {
    return true;
  }
}
