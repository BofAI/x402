/**
 * EVM facilitator mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.evm.exact_permit.facilitator.ExactPermitEvmFacilitatorMechanism`.
 *
 * Settles by calling `PaymentPermit.permitTransferFrom(permit, owner, signature)`
 * via the facilitator's EVM signer (viem).
 */

import {
  BaseExactPermitFacilitatorMechanism,
  type BaseExactPermitFee,
} from '../../_exact_permit_base/facilitator.js';
import type {
  PaymentPermit,
  PaymentRequirements,
} from '../../../types/index.js';
import { FacilitatorSigner } from '../../../signers/facilitator/base.js';
import { EvmAddressConverter, type AddressConverter } from '../../../address.js';
import { getPaymentPermitAddress } from '../../../config.js';
import { KIND_MAP, PAYMENT_PERMIT_ABI } from '../../../abi.js';

export class ExactPermitEvmFacilitatorMechanism extends BaseExactPermitFacilitatorMechanism {
  constructor(signer: FacilitatorSigner, fee: BaseExactPermitFee = {}) {
    super(signer, fee);
  }

  protected getAddressConverter(): AddressConverter {
    return new EvmAddressConverter();
  }

  /**
   * Build the permit struct in viem's expected object shape and call
   * `permitTransferFrom` via the facilitator's EVM signer.
   */
  protected async settlePaymentOnly(
    permit: PaymentPermit,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const contractAddress = getPaymentPermitAddress(requirements.network);
    const norm = (s: string) => this.addressConverter.toEvmFormat(s);

    // viem `encodeFunctionData` accepts objects mirroring the ABI tuple components.
    const permitArg = {
      meta: {
        kind: KIND_MAP[permit.meta.kind],
        paymentId: permit.meta.paymentId as `0x${string}`,
        nonce: BigInt(permit.meta.nonce),
        validAfter: BigInt(permit.meta.validAfter),
        validBefore: BigInt(permit.meta.validBefore),
      },
      buyer: norm(permit.buyer),
      caller: norm(permit.caller),
      payment: {
        payToken: norm(permit.payment.payToken),
        payAmount: BigInt(permit.payment.payAmount),
        payTo: norm(permit.payment.payTo),
      },
      fee: {
        feeTo: norm(permit.fee.feeTo),
        feeAmount: BigInt(permit.fee.feeAmount),
      },
    };

    const owner = norm(permit.buyer);
    const sigHex = signature.startsWith('0x') ? signature : `0x${signature}`;

    return this.signer.writeContract(
      contractAddress,
      PAYMENT_PERMIT_ABI as unknown as unknown[],
      'permitTransferFrom',
      [permitArg, owner, sigHex],
      requirements.network,
    );
  }
}
