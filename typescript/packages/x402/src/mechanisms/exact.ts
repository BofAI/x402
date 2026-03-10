/**
 * ExactPermitTronClientMechanism - TRON client mechanism for "exact_permit" payment scheme
 *
 * Uses TIP-712 (TRON's EIP-712 implementation) for signing PaymentPermit.
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
  TronAddressConverter,
  TRON_ZERO_ADDRESS,
  paymentIdToBytes,
  PermitValidationError,
} from '../index.js';

/**
 * TRON client mechanism for "exact_permit" payment scheme
 */
export class ExactPermitTronClientMechanism implements ClientMechanism {
  private signer: ClientSigner;
  private addressConverter = new TronAddressConverter();

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
    const zeroAddress = TRON_ZERO_ADDRESS; // Use TRON zero address for consistency with Python

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

    // Build EIP-712 domain (no version field per contract spec)
    // Note: domain name is "PaymentPermit", not "PaymentPermitDetails"
    const permitAddress = getPaymentPermitAddress(requirements.network);
    const domain = {
      name: 'PaymentPermit',
      chainId: getChainId(requirements.network),
      verifyingContract: this.addressConverter.toEvmFormat(permitAddress),
    };

    // Convert permit to EIP-712 compatible format:
    // 1. kind: string -> uint8 (number)
    // 2. paymentId: keep as hex string (TronWeb expects hex for bytes16)
    // 3. uint256 values: string -> BigInt (for proper EIP-712 encoding)
    // 4. All addresses: TRON Base58 -> EVM hex
    const permitForSigning = {
      meta: {
        kind: KIND_MAP[permit.meta.kind],
        paymentId: permit.meta.paymentId,  // Keep as hex string
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

    // Debug: log exact message being signed
    console.log('[SIGN] Domain:', JSON.stringify(domain));
    console.log('[SIGN] Message:', JSON.stringify(permitForSigning, (key, value) => {
      if (value instanceof Uint8Array) {
        return '0x' + Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      if (typeof value === 'bigint') {
        return value.toString();
      }
      return value;
    }));

    const signature = await this.signer.signTypedData(
      domain,
      PAYMENT_PERMIT_TYPES,
      permitForSigning as unknown as Record<string, unknown>,
      PAYMENT_PERMIT_PRIMARY_TYPE
    );

    console.log('[SIGN] Signature:', signature);

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
