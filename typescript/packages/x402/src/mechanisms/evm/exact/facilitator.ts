import { ExactBaseFacilitatorMechanism } from '../../_exact_base/facilitator.js';
import { EvmChainAdapter } from '../../_exact_base/evmAdapter.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from '../../../types/index.js';

/**
 * BSC / EVM facilitator mechanism for the `exact` scheme.
 *
 * Mirrors Python `mechanisms.evm.exact.facilitator.ExactEvmFacilitatorMechanism`.
 */
export class ExactEvmFacilitatorMechanism extends ExactBaseFacilitatorMechanism {
  constructor() {
    super(new EvmChainAdapter());
  }

  /**
   * Settle the ERC-3009 authorization by calling `transferWithAuthorization`
   * on the token contract.
   *
   * TODO(v0.6.0b): wire a viem `WalletClient` and invoke the contract. Until
   * then this returns `success: false` so the upstream caller knows the
   * chain integration is not yet wired.
   */
  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return {
      success: false,
      network: requirements.network,
      errorReason: 'evm_exact_settle_not_implemented',
    };
  }
}
