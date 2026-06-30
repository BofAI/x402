/**
 * TRON facilitator mechanism for the `exact` (ERC-3009) scheme.
 *
 * Mirrors Python `mechanisms.tron.exact.facilitator.ExactTronFacilitatorMechanism`.
 *
 * Settles by calling `transferWithAuthorization(from, to, value, validAfter,
 * validBefore, nonce, v, r, s)` directly on the TRC20 token contract via the
 * facilitator's TRON signer.
 */

import { ExactBaseFacilitatorMechanism } from '../../_exact_base/facilitator.js';
import { TronChainAdapter } from '../../_exact_base/tronAdapter.js';
import type {
  PaymentRequirements,
  TransferAuthorization,
} from '../../../types/index.js';
import { FacilitatorSigner } from '../../../signers/facilitator/base.js';
import { TRANSFER_WITH_AUTHORIZATION_ABI } from '../../../abi.js';

/**
 * Function selector for tronweb's `triggerSmartContract`.
 * Must match the on-chain ABI exactly.
 */
const TRANSFER_WITH_AUTH_SELECTOR =
  'transferWithAuthorization(' +
  'address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32' +
  ')';

export class ExactTronFacilitatorMechanism extends ExactBaseFacilitatorMechanism {
  constructor(
    signer: FacilitatorSigner,
    options: { allowedTokens?: ReadonlyArray<string> } = {},
  ) {
    super(signer, new TronChainAdapter(), options);
  }

  protected async settlePaymentOnly(
    auth: TransferAuthorization,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const adapter = this.adapter;
    const { v, r, s } = this.splitSignature(signature);

    // tronweb's triggerSmartContract expects address values as 0x EVM hex.
    const args = [
      { type: 'address', value: adapter.toSigningAddress(auth.from) },
      { type: 'address', value: adapter.toSigningAddress(auth.to) },
      { type: 'uint256', value: auth.value },
      { type: 'uint256', value: String(auth.validAfter) },
      { type: 'uint256', value: String(auth.validBefore) },
      {
        type: 'bytes32',
        value: auth.nonce.startsWith('0x') ? auth.nonce : `0x${auth.nonce}`,
      },
      { type: 'uint8', value: v },
      { type: 'bytes32', value: r },
      { type: 'bytes32', value: s },
    ];

    return this.signer.writeContract(
      requirements.asset, // TRC20 token is the verifying contract
      TRANSFER_WITH_AUTHORIZATION_ABI as unknown as unknown[],
      TRANSFER_WITH_AUTH_SELECTOR,
      args,
      requirements.network,
    );
  }
}
