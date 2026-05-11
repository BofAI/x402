import {
  BaseExactPermitFacilitatorMechanism,
  type BaseExactPermitFee,
} from '../../_exact_permit_base/facilitator.js';
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from '../../../types/index.js';

/**
 * TRON facilitator mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_permit.facilitator.ExactPermitTronFacilitatorMechanism`.
 */
export class ExactPermitTronFacilitatorMechanism extends BaseExactPermitFacilitatorMechanism {
  constructor(fee: BaseExactPermitFee) {
    super(fee);
  }

  /**
   * Submit `permitTransferFrom` to the TRON PaymentPermit contract.
   *
   * TODO(v0.6.0b): wire tronweb and call `PaymentPermit.permitTransferFrom`.
   */
  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return {
      success: false,
      network: requirements.network,
      errorReason: 'tron_exact_permit_settle_not_implemented',
    };
  }
}
