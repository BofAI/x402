/**
 * ExactPermitEvmClientMechanism - EVM client mechanism for "exact_permit" payment scheme
 */

import type {
  ClientMechanism,
  ClientSigner,
  PaymentRequirements,
  PaymentPayload,
  PaymentPermit,
  PaymentPermitContext,
} from '../index.js';
import {
  KIND_MAP,
  PAYMENT_PERMIT_TYPES,
  PAYMENT_PERMIT_PRIMARY_TYPE,
  getChainId,
  getPaymentPermitAddress,
  EVM_ZERO_ADDRESS,
  EvmAddressConverter,
  ZERO_ADDRESS_HEX,
  PermitValidationError,
} from '../index.js';

/**
 * EVM client mechanism for "exact_permit" payment scheme
 */
export class ExactPermitEvmClientMechanism implements ClientMechanism {
  private signer: ClientSigner;
  private addressConverter = new EvmAddressConverter();

  constructor(signer: ClientSigner) {
    this.signer = signer;
  }

  getSigner(): ClientSigner {
    return this.signer;
  }

  scheme(): string {
    return 'exact_permit';
  }

  async createPaymentPayload(
    requirements: PaymentRequirements,
    resource: string,
    extensions?: { paymentPermitContext?: PaymentPermitContext }
  ): Promise<PaymentPayload> {
    const context = extensions?.paymentPermitContext;
    if (!context) {
      throw new PermitValidationError('missing_context', 'paymentPermitContext is required');
    }

    const buyerAddress = this.signer.getAddress();
    const zeroAddress = EVM_ZERO_ADDRESS;

    const permit: PaymentPermit = {
      meta: {
        kind: context.meta.kind,
        paymentId: context.meta.paymentId,
        nonce: context.meta.nonce,
        validAfter: context.meta.validAfter,
        validBefore: context.meta.validBefore,
      },
      buyer: buyerAddress,
      caller: requirements.extra?.fee?.caller || zeroAddress,
      payment: {
        payToken: requirements.asset,
        payAmount: requirements.amount,
        payTo: requirements.payTo,
      },
      fee: {
        feeTo: requirements.extra?.fee?.feeTo || zeroAddress,
        feeAmount: requirements.extra?.fee?.feeAmount || '0',
      },
    };

    // Ensure allowance
    const totalAmount = BigInt(permit.payment.payAmount) + BigInt(permit.fee.feeAmount);
    await this.signer.ensureAllowance(
      permit.payment.payToken,
      totalAmount,
      requirements.network
    );

    // Build EIP-712 domain
    const permitAddress = getPaymentPermitAddress(requirements.network);
    const domain = {
      name: 'PaymentPermit',
      chainId: getChainId(requirements.network),
      verifyingContract: this.addressConverter.toEvmFormat(permitAddress),
    };

    // Convert permit to EIP-712 compatible format
    const permitForSigning = {
      meta: {
        kind: KIND_MAP[permit.meta.kind],
        paymentId: permit.meta.paymentId,
        nonce: BigInt(permit.meta.nonce),
        validAfter: permit.meta.validAfter,
        validBefore: permit.meta.validBefore,
      },
      buyer: this.addressConverter.toEvmFormat(permit.buyer),
      caller: this.addressConverter.toEvmFormat(permit.caller),
      payment: {
        payToken: this.addressConverter.toEvmFormat(permit.payment.payToken),
        payAmount: BigInt(permit.payment.payAmount),
        payTo: this.addressConverter.toEvmFormat(permit.payment.payTo),
      },
      fee: {
        feeTo: this.addressConverter.toEvmFormat(permit.fee.feeTo),
        feeAmount: BigInt(permit.fee.feeAmount),
      },
    };

    const signature = await this.signer.signTypedData(
      domain,
      PAYMENT_PERMIT_TYPES,
      permitForSigning as unknown as Record<string, unknown>,
      PAYMENT_PERMIT_PRIMARY_TYPE
    );

    return {
      x402Version: 2,
      resource: { url: resource },
      accepted: requirements,
      payload: {
        signature,
        paymentPermit: permit,
      },
      extensions: {},
    };
  }
}
