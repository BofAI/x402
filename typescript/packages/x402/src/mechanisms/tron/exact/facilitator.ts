import { ExactBaseFacilitatorMechanism } from '../../_exact_base/facilitator.js';
import { TronChainAdapter } from '../../_exact_base/tronAdapter.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from '../../../types/index.js';

/**
 * TRON facilitator mechanism for the `exact` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact.facilitator.ExactTronFacilitatorMechanism`.
 */
export class ExactTronFacilitatorMechanism extends ExactBaseFacilitatorMechanism {
  constructor() {
    super(new TronChainAdapter());
  }

  /**
   * Settle the authorization on TRON by calling `transferWithAuthorization`.
   *
   * TODO(v0.6.0b): wire tronweb / @bankofai/agent-wallet TRON broadcasting.
   */
  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return {
      success: false,
      network: requirements.network,
      errorReason: 'tron_exact_settle_not_implemented',
    };
  }
}
