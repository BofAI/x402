/**
 * Shared base for `exact_permit` scheme facilitator mechanisms.
 *
 * Mirrors Python `mechanisms._exact_permit_base.facilitator.BaseExactPermitFacilitatorMechanism`.
 *
 * Subclasses override:
 * - {@link getAddressConverter} — chain-specific address normalization
 * - {@link settlePaymentOnly} — chain-specific contract call (PaymentPermit.permitTransferFrom)
 */

import { FacilitatorSigner } from '../../signers/facilitator/base.js';
import type { FacilitatorMechanism } from '../../facilitator/x402Facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentPermit,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../../types/index.js';
import {
  KIND_MAP,
  PAYMENT_PERMIT_PRIMARY_TYPE,
  PAYMENT_PERMIT_TYPES,
} from '../../abi.js';
import { findByAddress } from '../../tokens.js';
import { getChainId, getPaymentPermitAddress } from '../../config.js';
import type { AddressConverter } from '../../address.js';

const SCHEME_EXACT_PERMIT = 'exact_permit';

/** Fee policy used by `feeQuote`. */
export interface BaseExactPermitFee {
  /**
   * Address that collects the facilitator fee. Defaults to
   * `signer.getAddress()` when undefined.
   */
  feeTo?: string;
  /** Optional caller address that the on-chain contract requires. */
  caller?: string;
  /**
   * Per-symbol base fee (smallest unit string). Token symbol is uppercased
   * before lookup. Tokens not in this map are rejected by `fee_quote` and
   * `_validate_permit`.
   */
  baseFee?: Record<string, string>;
  /**
   * Optional token allowlist (lowercased addresses). If set, only tokens
   * in this set are accepted; otherwise all tokens pass the address check.
   */
  allowedTokens?: ReadonlyArray<string>;
}

/**
 * Tuple shape passed to `triggerSmartContract` (TRON) or `writeContract` (EVM)
 * for `PaymentPermit.permitTransferFrom`. Matches the on-chain ABI tuple.
 */
export type PermitTuple = [
  // meta
  [
    number,        // kind (uint8)
    `0x${string}`, // paymentId (bytes16)
    string,        // nonce (uint256 string)
    number,        // validAfter (uint256)
    number,        // validBefore (uint256)
  ],
  string, // buyer (address)
  string, // caller (address)
  // payment
  [
    string, // payToken
    string, // payAmount (uint256 string)
    string, // payTo
  ],
  // fee
  [
    string, // feeTo
    string, // feeAmount (uint256 string)
  ],
];

const FEE_QUOTE_EXPIRY_SECONDS = 300;

export abstract class BaseExactPermitFacilitatorMechanism
  implements FacilitatorMechanism
{
  protected readonly signer: FacilitatorSigner;
  protected readonly feeTo: string;
  protected readonly caller: string;
  protected readonly baseFeeMap: Record<string, bigint>;
  protected readonly allowedTokens: ReadonlySet<string> | null;
  protected readonly addressConverter: AddressConverter;

  constructor(signer: FacilitatorSigner, fee: BaseExactPermitFee = {}) {
    this.signer = signer;
    this.feeTo = fee.feeTo ?? signer.getAddress();
    this.caller = fee.caller ?? signer.getAddress();
    this.addressConverter = this.getAddressConverter();
    this.baseFeeMap = {};
    if (fee.baseFee) {
      for (const [symbol, amount] of Object.entries(fee.baseFee)) {
        this.baseFeeMap[symbol.toUpperCase()] = BigInt(amount);
      }
    }
    this.allowedTokens = fee.allowedTokens
      ? new Set(fee.allowedTokens.map((t) => this.addressConverter.normalize(t)))
      : null;
  }

  scheme(): string {
    return SCHEME_EXACT_PERMIT;
  }

  /** Chain-specific address converter. */
  protected abstract getAddressConverter(): AddressConverter;

  /**
   * Look up base fee for a token by symbol. Returns `null` if the token is
   * not registered in the SDK token registry or the symbol has no entry
   * in `baseFeeMap`.
   */
  protected getBaseFee(tokenAddress: string, network: string): bigint | null {
    const tokenInfo = findByAddress(network, tokenAddress);
    if (!tokenInfo) return null;
    const symbol = tokenInfo.symbol.toUpperCase();
    if (!(symbol in this.baseFeeMap)) return null;
    return this.baseFeeMap[symbol]!;
  }

  async feeQuote(
    accept: PaymentRequirements,
    _context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null> {
    const baseFee = this.getBaseFee(accept.asset, accept.network);
    if (baseFee === null) {
      return null;
    }
    return {
      fee: {
        feeTo: this.feeTo,
        feeAmount: baseFee.toString(),
        caller: this.caller,
      },
      pricing: 'flat',
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      expiresAt: Math.floor(Date.now() / 1000) + FEE_QUOTE_EXPIRY_SECONDS,
    } as unknown as FeeQuoteResponse;
  }

  /**
   * Off-chain verify path: structural + fee + signature checks.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const permit = payload.payload.paymentPermit;
    if (!permit) {
      return { isValid: false, invalidReason: 'missing_permit' };
    }
    const validationError = this.validatePermit(permit, requirements);
    if (validationError) {
      return { isValid: false, invalidReason: validationError };
    }

    const signature = payload.payload.signature;
    const validSig = await this.verifySignature(
      permit,
      signature,
      requirements.network,
    );
    if (!validSig) {
      return { isValid: false, invalidReason: 'invalid_signature' };
    }
    return { isValid: true };
  }

  /**
   * Settle the permit on-chain: verify, then submit via subclass
   * `settlePaymentOnly`, then poll the receipt.
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verifyResult = await this.verify(payload, requirements);
    if (!verifyResult.isValid) {
      return {
        success: false,
        network: requirements.network,
        errorReason: verifyResult.invalidReason,
      };
    }
    const permit = payload.payload.paymentPermit!;
    const signature = payload.payload.signature;

    let txHash: string | null;
    try {
      txHash = await this.settlePaymentOnly(permit, signature, requirements);
    } catch (err) {
      return {
        success: false,
        network: requirements.network,
        errorReason: `settle_error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!txHash) {
      return {
        success: false,
        network: requirements.network,
        errorReason: 'transaction_failed',
      };
    }

    // Poll receipt
    try {
      const receipt = await this.signer.waitForTransactionReceipt(
        txHash,
        requirements.network,
      );
      if (receipt.status !== 'confirmed') {
        return {
          success: false,
          network: requirements.network,
          transaction: txHash,
          errorReason: 'transaction_failed_on_chain',
        };
      }
    } catch (err) {
      // Receipt timeout — return tx hash + flag as failed-pending so the
      // client can re-check; same shape Python uses.
      return {
        success: false,
        network: requirements.network,
        transaction: txHash,
        errorReason: `receipt_timeout: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return {
      success: true,
      network: requirements.network,
      transaction: txHash,
    };
  }

  // -------------------------------------------------------------------------
  // Protected helpers used by subclasses + verify/settle
  // -------------------------------------------------------------------------

  /**
   * Structural + fee validation. Returns the error reason string, or `null`
   * if valid.
   */
  protected validatePermit(
    permit: PaymentPermit,
    requirements: PaymentRequirements,
  ): string | null {
    const norm = (s: string) => this.addressConverter.normalize(s);

    if (this.allowedTokens !== null && !this.allowedTokens.has(norm(permit.payment.payToken))) {
      return 'token_not_allowed';
    }
    try {
      if (BigInt(permit.payment.payAmount) < BigInt(requirements.amount)) {
        return 'amount_mismatch';
      }
    } catch {
      return 'invalid_amount';
    }
    if (norm(permit.payment.payTo) !== norm(requirements.payTo)) {
      return 'payto_mismatch';
    }
    if (norm(permit.payment.payToken) !== norm(requirements.asset)) {
      return 'token_mismatch';
    }
    if (norm(permit.fee.feeTo) !== norm(this.feeTo)) {
      return 'fee_to_mismatch';
    }
    const expectedFee = this.getBaseFee(permit.payment.payToken, requirements.network);
    if (expectedFee === null) {
      return 'unsupported_token';
    }
    try {
      if (BigInt(permit.fee.feeAmount) < expectedFee) {
        return 'fee_amount_mismatch';
      }
    } catch {
      return 'invalid_fee';
    }

    const now = Math.floor(Date.now() / 1000);
    if (permit.meta.validBefore < now) return 'expired';
    if (permit.meta.validAfter > now) return 'not_yet_valid';

    return null;
  }

  /**
   * Verify the buyer's EIP-712 / TIP-712 signature against the permit.
   *
   * Build the message in the exact shape the buyer signed:
   * - `kind` as numeric (0 for PAYMENT_ONLY)
   * - `paymentId` as hex string (bytes16 — viem accepts hex)
   * - `nonce` / amounts as BigInt strings
   * - all addresses converted to 0x EVM hex (required for TRON TIP-712)
   */
  protected async verifySignature(
    permit: PaymentPermit,
    signature: string,
    network: string,
  ): Promise<boolean> {
    const permitContract = getPaymentPermitAddress(network);
    const chainId = getChainId(network);
    const converter = this.addressConverter;

    const message: Record<string, unknown> = {
      meta: {
        kind: KIND_MAP[permit.meta.kind],
        paymentId: permit.meta.paymentId, // hex string OK
        nonce: BigInt(permit.meta.nonce),
        validAfter: BigInt(permit.meta.validAfter),
        validBefore: BigInt(permit.meta.validBefore),
      },
      buyer: converter.toEvmFormat(permit.buyer),
      caller: converter.toEvmFormat(permit.caller),
      payment: {
        payToken: converter.toEvmFormat(permit.payment.payToken),
        payAmount: BigInt(permit.payment.payAmount),
        payTo: converter.toEvmFormat(permit.payment.payTo),
      },
      fee: {
        feeTo: converter.toEvmFormat(permit.fee.feeTo),
        feeAmount: BigInt(permit.fee.feeAmount),
      },
    };

    return this.signer.verifyTypedData(
      permit.buyer,
      {
        name: 'PaymentPermit',
        chainId,
        verifyingContract: converter.toEvmFormat(permitContract),
      },
      PAYMENT_PERMIT_TYPES as unknown as Record<
        string,
        ReadonlyArray<{ name: string; type: string }>
      >,
      message,
      signature,
      PAYMENT_PERMIT_PRIMARY_TYPE,
    );
  }

  /**
   * Build the tuple passed to `permitTransferFrom(permit, owner, signature)`.
   * Addresses are returned in the chain-canonical format (Base58 for TRON,
   * 0x hex for EVM) since each chain's writer accepts both — let the subclass
   * normalize further if needed.
   */
  protected buildPermitTuple(permit: PaymentPermit): PermitTuple {
    const converter = this.addressConverter;
    const norm = (s: string) => converter.normalize(s);
    return [
      [
        KIND_MAP[permit.meta.kind],
        permit.meta.paymentId as `0x${string}`,
        permit.meta.nonce,
        permit.meta.validAfter,
        permit.meta.validBefore,
      ],
      norm(permit.buyer),
      norm(permit.caller),
      [
        norm(permit.payment.payToken),
        permit.payment.payAmount,
        norm(permit.payment.payTo),
      ],
      [norm(permit.fee.feeTo), permit.fee.feeAmount],
    ];
  }

  /**
   * Submit the permit on-chain. Chain-specific — subclasses MUST implement.
   *
   * Returns the tx hash on broadcast success, or `null` on failure (the base
   * wraps null into a `SettleResponse{ success: false }`).
   */
  protected abstract settlePaymentOnly(
    permit: PaymentPermit,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null>;
}
