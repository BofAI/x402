/**
 * TRON facilitator mechanism for the `exact_gasfree` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_gasfree.facilitator`.
 * The buyer signs the GasFree TIP-712 permit, and the facilitator submits it
 * through the configured GasFree API proxy.
 */

import {
  BaseExactPermitFacilitatorMechanism,
  type BaseExactPermitFee,
} from '../../_exact_permit_base/facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPermit,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../../../types/index.js';
import { FacilitatorSigner } from '../../../signers/facilitator/base.js';
import { TronAddressConverter, type AddressConverter } from '../../../address.js';
import {
  GASFREE_TYPES,
  GasFreeAPIClient,
  type GasFreeProvider,
  getGasFreeDomain,
} from '../../../utils/gasfree.js';
import { GASFREE_PRIMARY_TYPE } from '../../../abi.js';

const SCHEME_EXACT_GASFREE = 'exact_gasfree';
const FEE_QUOTE_EXPIRY_SECONDS = 300;

export interface ExactGasFreeFacilitatorOptions extends BaseExactPermitFee {
  clients: Record<string, GasFreeAPIClient>;
}

export class ExactGasFreeFacilitatorMechanism extends BaseExactPermitFacilitatorMechanism {
  private readonly clients: Record<string, GasFreeAPIClient>;

  constructor(
    signer: FacilitatorSigner,
    options: ExactGasFreeFacilitatorOptions,
  ) {
    super(signer, options);
    this.clients = options.clients;
  }

  scheme(): string {
    return SCHEME_EXACT_GASFREE;
  }

  protected getAddressConverter(): AddressConverter {
    return new TronAddressConverter();
  }

  private getApiClient(network: string): GasFreeAPIClient {
    const client = this.clients[network];
    if (!client) {
      throw new Error(`GasFree is not configured for network: ${network}`);
    }
    return client;
  }

  async feeQuote(
    accept: PaymentRequirements,
    _context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null> {
    const baseFee = this.getBaseFee(accept.asset, accept.network);
    if (baseFee === null) return null;

    const providers = await this.getApiClient(accept.network).getProviders();
    if (providers.length === 0) return null;

    const selected = providers[Math.floor(Math.random() * providers.length)]!;
    return {
      fee: {
        feeTo: selected.address,
        feeAmount: baseFee.toString(),
        caller: selected.address,
      },
      pricing: 'flat',
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      expiresAt: Math.floor(Date.now() / 1000) + FEE_QUOTE_EXPIRY_SECONDS,
    } as FeeQuoteResponse;
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const permit = payload.payload.paymentPermit;
    if (!permit) {
      return { isValid: false, invalidReason: 'missing_permit' };
    }

    const validationError = await this.validateGasFreePermit(permit, requirements);
    if (validationError) {
      return { isValid: false, invalidReason: validationError };
    }

    const validSig = await this.verifyGasFreeSignature(
      permit,
      payload.payload.signature,
      requirements.network,
    );
    if (!validSig) {
      return { isValid: false, invalidReason: 'invalid_signature' };
    }

    return { isValid: true };
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        errorReason: verifyResult.invalidReason ?? 'verification_failed',
        network: requirements.network,
      };
    }

    const permit = payload.payload.paymentPermit;
    const signature = payload.payload.signature;
    const gasfreeAddress = payload.extensions?.gasfreeAddress;
    if (!permit || !signature || typeof gasfreeAddress !== 'string') {
      return {
        success: false,
        errorReason: 'missing_payload_data',
        network: requirements.network,
      };
    }

    try {
      const balance = await this.signer.checkBalance(
        requirements.asset,
        requirements.network,
        gasfreeAddress,
      );
      const requiredTotal =
        BigInt(requirements.amount) + BigInt(permit.fee.feeAmount);
      if (balance < requiredTotal) {
        return {
          success: false,
          errorReason: `insufficient balance in gasfree wallet ${gasfreeAddress}`,
          network: requirements.network,
        };
      }
    } catch {
      // Python treats this as a best-effort preflight; submission can still fail
      // with the relayer's exact reason.
    }

    const client = this.getApiClient(requirements.network);
    try {
      const traceId = await this.settlePaymentOnly(
        permit,
        signature,
        requirements,
      );
      if (!traceId) {
        return {
          success: false,
          errorReason: 'api_no_response',
          network: requirements.network,
        };
      }

      const result = await client.waitForSuccess(traceId);
      if (!result.txnHash) {
        return {
          success: false,
          errorReason: 'missing_transaction_hash',
          network: requirements.network,
        };
      }

      return {
        success: true,
        transaction: result.txnHash,
        network: requirements.network,
      };
    } catch (err) {
      return {
        success: false,
        errorReason: err instanceof Error ? err.message : String(err),
        network: requirements.network,
      };
    }
  }

  private async validateGasFreePermit(
    permit: PaymentPermit,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const norm = (s: string) => this.addressConverter.normalize(s);

    if (
      this.allowedTokens !== null &&
      !this.allowedTokens.has(norm(permit.payment.payToken))
    ) {
      return 'token_not_allowed';
    }

    if (BigInt(permit.payment.payAmount) < BigInt(requirements.amount)) {
      return 'amount_mismatch';
    }
    if (norm(permit.payment.payToken) !== norm(requirements.asset)) {
      return 'token_mismatch';
    }
    if (norm(permit.payment.payTo) !== norm(requirements.payTo)) {
      return 'payto_mismatch';
    }

    let providers: GasFreeProvider[];
    try {
      providers = await this.getApiClient(requirements.network).getProviders();
    } catch {
      if (norm(permit.fee.feeTo) !== norm(this.feeTo)) {
        return 'fee_to_mismatch';
      }
      providers = [];
    }

    if (providers.length > 0) {
      const allowedProviders = new Set(providers.map((p) => norm(p.address)));
      if (!allowedProviders.has(norm(permit.fee.feeTo))) {
        return 'fee_to_mismatch';
      }
    }

    const expectedFee = this.getBaseFee(
      permit.payment.payToken,
      requirements.network,
    );
    if (expectedFee === null) {
      return 'unsupported_token';
    }
    if (BigInt(permit.fee.feeAmount) < expectedFee) {
      return 'fee_amount_mismatch';
    }

    const now = Math.floor(Date.now() / 1000);
    if (permit.meta.validAfter > now) {
      return 'not_yet_valid';
    }
    if (permit.meta.validBefore < now) {
      return 'expired';
    }
    return null;
  }

  private async verifyGasFreeSignature(
    permit: PaymentPermit,
    signature: string,
    network: string,
  ): Promise<boolean> {
    const converter = this.addressConverter;
    const message: Record<string, unknown> = {
      token: converter.toEvmFormat(permit.payment.payToken),
      serviceProvider: converter.toEvmFormat(permit.fee.feeTo),
      user: converter.toEvmFormat(permit.buyer),
      receiver: converter.toEvmFormat(permit.payment.payTo),
      value: BigInt(permit.payment.payAmount),
      maxFee: BigInt(permit.fee.feeAmount),
      deadline: BigInt(permit.meta.validBefore),
      version: BigInt(1),
      nonce: BigInt(permit.meta.nonce),
    };

    return this.signer.verifyTypedData(
      permit.buyer,
      getGasFreeDomain(network),
      GASFREE_TYPES as unknown as Record<
        string,
        ReadonlyArray<{ name: string; type: string }>
      >,
      message,
      signature,
      GASFREE_PRIMARY_TYPE,
    );
  }

  protected async settlePaymentOnly(
    permit: PaymentPermit,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null> {
    const converter = this.addressConverter;
    const message = {
      token: converter.toEvmFormat(permit.payment.payToken),
      serviceProvider: converter.toEvmFormat(permit.fee.feeTo),
      user: converter.toEvmFormat(permit.buyer),
      receiver: converter.toEvmFormat(permit.payment.payTo),
      value: BigInt(permit.payment.payAmount),
      maxFee: BigInt(permit.fee.feeAmount),
      deadline: BigInt(permit.meta.validBefore),
      version: BigInt(1),
      nonce: BigInt(permit.meta.nonce),
    };

    return this.getApiClient(requirements.network).submit(
      getGasFreeDomain(requirements.network),
      message,
      signature,
    );
  }
}
