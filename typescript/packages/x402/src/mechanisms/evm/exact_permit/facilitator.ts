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
 * BSC / EVM facilitator mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.evm.exact_permit.facilitator.ExactPermitEvmFacilitatorMechanism`.
 */
export class ExactPermitEvmFacilitatorMechanism extends BaseExactPermitFacilitatorMechanism {
  constructor(fee: BaseExactPermitFee) {
    super(fee);
  }

  /**
   * Submit `permit` + `transferFrom` on-chain via the PaymentPermit contract.
   *
   * TODO(v0.6.0b): wire viem WalletClient and call PaymentPermit
   * `permitTransferFrom`.
   */
  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return {
      success: false,
      network: requirements.network,
      errorReason: 'evm_exact_permit_settle_not_implemented',
    };
  }
}
