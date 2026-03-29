/**
 * ExactTronClientMechanism - TRON client mechanism for "exact" payment scheme
 *
 * Uses ERC-3009 TransferWithAuthorization with TIP-712 signing.
 * Addresses are converted from TRON Base58 to EVM hex for signing.
 */

import type {
  ClientMechanism,
  ClientSigner,
  PaymentRequirements,
  PaymentPayload,
} from '../index.js';
import {
  getChainId,
  TronAddressConverter,
} from '../index.js';
import { findByAddress } from '../tokens.js';
import {
  SCHEME_EXACT,
  TRANSFER_AUTH_EIP712_TYPES,
  TRANSFER_AUTH_PRIMARY_TYPE,
  buildEip712Domain,
  buildEip712Message,
  createNonce,
  createValidityWindow,
} from './nativeExact.js';
import type { TransferAuthorization } from './nativeExact.js';

/**
 * TRON client mechanism for "exact" payment scheme
 */
export class ExactTronClientMechanism implements ClientMechanism {
  private signer: ClientSigner;
  private addressConverter = new TronAddressConverter();

  constructor(signer: ClientSigner) {
    this.signer = signer;
  }

  getSigner(): ClientSigner {
    return this.signer;
  }

  scheme(): string {
    return SCHEME_EXACT;
  }

  async createPaymentPayload(
    requirements: PaymentRequirements,
    resource: string,
  ): Promise<PaymentPayload> {
    const converter = this.addressConverter;
    const fromAddr = converter.toEvmFormat(this.signer.getAddress());
    const toAddr = converter.toEvmFormat(requirements.payTo);

    const [validAfter, validBefore] = createValidityWindow();
    const nonce = createNonce();

    const authorization: TransferAuthorization = {
      from: fromAddr,
      to: toAddr,
      value: requirements.amount,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce,
    };

    // Look up token metadata for EIP-712 domain
    const tokenInfo = findByAddress(requirements.network, requirements.asset);
    const tokenName = tokenInfo?.name ?? 'Unknown Token';
    const tokenVersion = '1';

    const chainId = getChainId(requirements.network);
    const domain = buildEip712Domain(
      tokenName,
      tokenVersion,
      chainId,
      converter.toEvmFormat(requirements.asset),
    );

    const message = buildEip712Message(authorization, (addr) => converter.toEvmFormat(addr));

    const signature = await this.signer.signTypedData(
      domain,
      TRANSFER_AUTH_EIP712_TYPES,
      message,
      TRANSFER_AUTH_PRIMARY_TYPE
    );

    return {
      x402Version: 2,
      resource: { url: resource },
      accepted: requirements,
      payload: {
        signature,
        paymentPermit: undefined as never,
      },
      extensions: {
        transferAuthorization: authorization,
      },
    };
  }
}
