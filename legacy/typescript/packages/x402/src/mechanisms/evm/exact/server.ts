import { ExactBaseServerMechanism } from '../../_exact_base/server.js';
import { EvmChainAdapter } from '../../_exact_base/evmAdapter.js';
import type { PaymentPermit } from '../../../types/index.js';

/**
 * BSC / EVM server mechanism for the `exact` scheme.
 *
 * Mirrors Python `mechanisms.evm.exact.server.ExactEvmServerMechanism`.
 */
export class ExactEvmServerMechanism extends ExactBaseServerMechanism {
  constructor() {
    super(new EvmChainAdapter());
  }

  /**
   * EVM signature verification for ERC-3009 authorizations.
   *
   * TODO(v0.6.0b): port the EIP-712 typed-data signature recovery from
   * Python `ExactBaseServerMechanism._verify_signature`. Until then this
   * returns `true` and lets the facilitator be the source of truth.
   */
  async verifySignature(
    _permit: PaymentPermit | null | undefined,
    _signature: string,
    _network: string,
  ): Promise<boolean> {
    return true;
  }
}
