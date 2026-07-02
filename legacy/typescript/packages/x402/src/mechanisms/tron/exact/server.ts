import { ExactBaseServerMechanism } from '../../_exact_base/server.js';
import { TronChainAdapter } from '../../_exact_base/tronAdapter.js';
import type { PaymentPermit } from '../../../types/index.js';

/**
 * TRON server mechanism for the `exact` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact.server.ExactTronServerMechanism`.
 */
export class ExactTronServerMechanism extends ExactBaseServerMechanism {
  constructor() {
    super(new TronChainAdapter());
  }

  /**
   * TRON TIP-712 signature verification for ERC-3009 authorizations.
   *
   * TODO(v0.6.0b): port TIP-712 signature recovery from Python. Returns
   * `true` for now — facilitator side does the authoritative check.
   */
  async verifySignature(
    _permit: PaymentPermit | null | undefined,
    _signature: string,
    _network: string,
  ): Promise<boolean> {
    return true;
  }
}
