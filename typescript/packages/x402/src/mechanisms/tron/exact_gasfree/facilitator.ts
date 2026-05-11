import type { FacilitatorMechanism } from '../../../facilitator/x402Facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../../../types/index.js';

const SCHEME_EXACT_GASFREE = 'exact_gasfree';

/** Config for {@link ExactGasFreeFacilitatorMechanism}. */
export interface ExactGasFreeFee {
  /** Recipient address that collects the facilitator fee (TRON Base58 or hex). */
  feeTo: string;
  /** Optional caller address bound on-chain. */
  caller?: string;
  /** Per-token base fee (smallest unit, decimal string). Key = `${network}:${tokenAddress}`. */
  baseFeesByToken?: Record<string, string>;
  /** Fallback fee when no per-token entry matches. */
  defaultBaseFee?: string;
}

/**
 * TRON facilitator mechanism for the `exact_gasfree` scheme.
 *
 * Mirrors Python `mechanisms.tron.exact_gasfree.facilitator.ExactGasFreeFacilitatorMechanism`.
 * Uses TRON GasFree (custodial relayer) — user signs TIP-712 permit, the
 * service provider submits the transaction on-chain.
 */
export class ExactGasFreeFacilitatorMechanism implements FacilitatorMechanism {
  constructor(private readonly fee: ExactGasFreeFee) {}

  scheme(): string {
    return SCHEME_EXACT_GASFREE;
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
   * Off-chain verify: structural checks. Real TIP-712 signature + GasFree
   * API deadline-clamping checks left as TODO.
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
    // TODO(v0.6.0b): TIP-712 signature recovery + GasFree balance/deadline check.
    return { isValid: true };
  }

  /**
   * Submit the GasFree permit through the GasFreeController contract.
   *
   * TODO(v0.6.0b): call GasFree relayer API or contract directly.
   */
  async settle(
    _payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return {
      success: false,
      network: requirements.network,
      errorReason: 'tron_exact_gasfree_settle_not_implemented',
    };
  }
}
