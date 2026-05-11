/**
 * Shared base for `exact_permit` scheme facilitator mechanisms.
 *
 * Mirrors Python `mechanisms._exact_permit_base.facilitator.BaseExactPermitFacilitatorMechanism`.
 */

import type { FacilitatorMechanism } from '../../facilitator/x402Facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../../types/index.js';

const SCHEME_EXACT_PERMIT = 'exact_permit';

/** Fee policy used by `feeQuote`. */
export interface BaseExactPermitFee {
  /** Address that collects the facilitator fee. */
  feeTo: string;
  /** Optional caller address that the on-chain contract requires. */
  caller?: string;
  /**
   * Base fee in smallest unit, keyed by `${network}:${tokenAddress}`. Tokens
   * not in this map use {@link defaultBaseFee}.
   */
  baseFeesByToken?: Record<string, string>;
  /** Fallback fee when no per-token entry matches. Default `"0"`. */
  defaultBaseFee?: string;
}

export abstract class BaseExactPermitFacilitatorMechanism implements FacilitatorMechanism {
  constructor(protected readonly fee: BaseExactPermitFee) {}

  scheme(): string {
    return SCHEME_EXACT_PERMIT;
  }

  async feeQuote(
    accept: PaymentRequirements,
    _context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null> {
    const key = `${accept.network}:${accept.asset.toLowerCase()}`;
    const feeAmount =
      this.fee.baseFeesByToken?.[key] ?? this.fee.defaultBaseFee ?? '0';
    return {
      fee: {
        feeTo: this.fee.feeTo,
        feeAmount,
        ...(this.fee.caller ? { caller: this.fee.caller } : {}),
      },
      pricing: 'fixed',
      scheme: this.scheme(),
      network: accept.network,
      asset: accept.asset,
    };
  }

  /**
   * Off-chain verify path: structural checks live here, signature + balance
   * + nonce + on-chain state checks go in subclass.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const permit = payload.payload.paymentPermit;
    if (!permit) {
      return { isValid: false, invalidReason: 'missing_permit' };
    }
    if (permit.payment.payToken !== requirements.asset) {
      return { isValid: false, invalidReason: 'asset_mismatch' };
    }
    if (permit.payment.payTo !== requirements.payTo) {
      return { isValid: false, invalidReason: 'payTo_mismatch' };
    }
    try {
      if (BigInt(permit.payment.payAmount) < BigInt(requirements.amount)) {
        return { isValid: false, invalidReason: 'amount_too_low' };
      }
    } catch {
      return { isValid: false, invalidReason: 'invalid_amount' };
    }

    // Chain-specific signature + on-chain balance / nonce checks
    return this.verifyOnChain(payload, requirements);
  }

  /**
   * Chain-specific on-chain verification. Default: trust upstream
   * (returns `isValid: true`). Subclasses MUST override for real
   * signature recovery + balance + nonce checks.
   */
  protected async verifyOnChain(
    _payload: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return { isValid: true };
  }

  /**
   * Submit the permit on-chain. Chain-specific — subclasses MUST implement
   * via viem (EVM) / tronweb (TRON).
   */
  abstract settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;
}
