/**
 * EVM (BSC) facilitator mechanism for the `exact` (ERC-3009) scheme.
 *
 * Mirrors Python `mechanisms.evm.exact.facilitator.ExactEvmFacilitatorMechanism`.
 *
 * Settles by calling `transferWithAuthorization(from, to, value, validAfter,
 * validBefore, nonce, v, r, s)` directly on the ERC20 token contract via
 * viem's typed encoding.
 */

import { ExactBaseFacilitatorMechanism } from '../../_exact_base/facilitator.js';
import { EvmChainAdapter } from '../../_exact_base/evmAdapter.js';
import type {
  PaymentRequirements,
  TransferAuthorization,
} from '../../../types/index.js';
import { FacilitatorSigner } from '../../../signers/facilitator/base.js';
import { TRANSFER_WITH_AUTHORIZATION_ABI } from '../../../abi.js';

export class ExactEvmFacilitatorMechanism extends ExactBaseFacilitatorMechanism {
  constructor(
    signer: FacilitatorSigner,
    options: { allowedTokens?: ReadonlyArray<string> } = {},
  ) {
    super(signer, new EvmChainAdapter(), options);
  }

  protected async settlePaymentOnly(
    auth: TransferAuthorization,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const adapter = this.adapter;
    const { v, r, s } = this.splitSignature(signature);

    return this.signer.writeContract(
      requirements.asset, // token contract is the verifying contract for ERC-3009
      TRANSFER_WITH_AUTHORIZATION_ABI as unknown as unknown[],
      'transferWithAuthorization',
      [
        adapter.toSigningAddress(auth.from),
        adapter.toSigningAddress(auth.to),
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce.startsWith('0x') ? auth.nonce : `0x${auth.nonce}`,
        v,
        r,
        s,
      ],
      requirements.network,
    );
  }
}
