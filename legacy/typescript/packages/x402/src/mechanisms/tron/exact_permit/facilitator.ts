/**
 * TRON facilitator mechanism for the `exact_permit` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_permit.facilitator.ExactPermitTronFacilitatorMechanism`.
 *
 * Settles by calling `PaymentPermit.permitTransferFrom(permit, owner, signature)`
 * on the configured PaymentPermit contract via the facilitator's TRON signer.
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
import { TronAddressConverter, type AddressConverter } from '../../../address.js';
import { getPaymentPermitAddress } from '../../../config.js';
import { PAYMENT_PERMIT_ABI } from '../../../abi.js';

/**
 * Function selector with full tuple layout. tronweb's `triggerSmartContract`
 * needs the exact bracket signature to compute the 4-byte method ID.
 *
 * Layout mirrors `PAYMENT_PERMIT_ABI.permitTransferFrom`:
 *   permit: tuple(meta, buyer, caller, payment, fee)
 *     meta: tuple(uint8 kind, bytes16 paymentId, uint256 nonce, uint256 validAfter, uint256 validBefore)
 *     payment: tuple(address payToken, uint256 payAmount, address payTo)
 *     fee: tuple(address feeTo, uint256 feeAmount)
 *   owner: address
 *   signature: bytes
 */
const PERMIT_TRANSFER_FROM_SELECTOR =
  'permitTransferFrom(' +
  '(' +
  '(uint8,bytes16,uint256,uint256,uint256),' +
  'address,' +
  'address,' +
  '(address,uint256,address),' +
  '(address,uint256)' +
  '),' +
  'address,' +
  'bytes' +
  ')';

const TUPLE_TYPE =
  '(' +
  '(uint8,bytes16,uint256,uint256,uint256),' +
  'address,' +
  'address,' +
  '(address,uint256,address),' +
  '(address,uint256)' +
  ')';

export class ExactPermitTronFacilitatorMechanism extends BaseExactPermitFacilitatorMechanism {
  constructor(signer: FacilitatorSigner, fee: BaseExactPermitFee = {}) {
    super(signer, fee);
  }

  protected getAddressConverter(): AddressConverter {
    return new TronAddressConverter();
  }

  /**
   * Call `PaymentPermit.permitTransferFrom` on TRON.
   *
   * tronweb's `triggerSmartContract` accepts tuple parameters as an array of
   * primitive values matching the type layout. Addresses must be 0x EVM hex
   * (TRON's internal representation for `address` ABI type).
   */
  protected async settlePaymentOnly(
    permit: PaymentPermit,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const contractAddress = getPaymentPermitAddress(requirements.network);
    const converter = this.addressConverter;
    const hex = (s: string) => converter.toEvmFormat(s);

    // Build the tuple as an array of primitive values (NOT objects).
    // tronweb's tuple encoder expects the array order to match the type signature.
    const permitTupleValue = [
      // meta: (uint8, bytes16, uint256, uint256, uint256)
      [
        // kind (PAYMENT_ONLY → 0)
        permit.meta.kind === 'PAYMENT_ONLY' ? 0 : 0,
        // paymentId — bytes16, accepted as hex string by tronweb
        permit.meta.paymentId,
        // nonce — uint256, accepted as string
        permit.meta.nonce,
        permit.meta.validAfter,
        permit.meta.validBefore,
      ],
      hex(permit.buyer),
      hex(permit.caller),
      // payment: (address, uint256, address)
      [
        hex(permit.payment.payToken),
        permit.payment.payAmount,
        hex(permit.payment.payTo),
      ],
      // fee: (address, uint256)
      [hex(permit.fee.feeTo), permit.fee.feeAmount],
    ];

    const sigBytes = signature.startsWith('0x') ? signature : `0x${signature}`;

    const args = [
      { type: TUPLE_TYPE, value: permitTupleValue },
      { type: 'address', value: hex(permit.buyer) },
      { type: 'bytes', value: sigBytes },
    ];

    return this.signer.writeContract(
      contractAddress,
      PAYMENT_PERMIT_ABI as unknown as unknown[],
      PERMIT_TRANSFER_FROM_SELECTOR,
      args,
      requirements.network,
    );
  }
}
