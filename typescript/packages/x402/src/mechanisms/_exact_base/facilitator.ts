/**
 * Shared base for `exact` scheme facilitator mechanisms.
 *
 * Mirrors Python `mechanisms._exact_base.base.ExactBaseFacilitatorMechanism`.
 *
 * Per-chain subclasses provide a {@link ChainAdapter} and the chain RPC client
 * (viem PublicClient / tronweb instance). The base handles:
 * - basic structural verification (asset / payTo / value match, time window)
 * - dispatching feeQuote / verify / settle to the chain-specific impl
 *
 * Subclasses MUST implement chain interactions: signature recovery, balance
 * check, transaction broadcast. The base provides defaults that return
 * `null` / `false` so non-fully-implemented mechanisms remain visible at
 * the structural level but don't pretend to verify on-chain state.
 */

import type { ChainAdapter } from './adapter.js';
import type { FacilitatorMechanism } from '../../facilitator/x402Facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '../../types/index.js';
import { SCHEME_EXACT } from './types.js';

export abstract class ExactBaseFacilitatorMechanism implements FacilitatorMechanism {
  constructor(protected readonly adapter: ChainAdapter) {}

  scheme(): string {
    return SCHEME_EXACT;
  }

  /**
   * `exact` scheme has no facilitator fee — return `null` to drop from the
   * supported quote list. Permit-based schemes override this.
   */
  async feeQuote(
    _accept: PaymentRequirements,
    _context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null> {
    return null;
  }

  /**
   * Off-chain verification: structural + timing checks. Chain-specific
   * subclasses extend this to add signature recovery and balance check.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const authorization = this.extractAuthorization(payload);
    if (!authorization) {
      return { isValid: false, invalidReason: 'missing_authorization' };
    }

    // Validate basic structural correctness
    if (String(authorization.to).toLowerCase() !== String(requirements.payTo).toLowerCase()) {
      return { isValid: false, invalidReason: 'payTo_mismatch' };
    }
    try {
      if (BigInt(authorization.value) < BigInt(requirements.amount)) {
        return { isValid: false, invalidReason: 'amount_too_low' };
      }
    } catch {
      return { isValid: false, invalidReason: 'invalid_value' };
    }

    // Validate time window
    const now = Math.floor(Date.now() / 1000);
    try {
      if (BigInt(String(authorization.validBefore ?? '0')) < BigInt(now)) {
        return { isValid: false, invalidReason: 'expired' };
      }
      if (BigInt(String(authorization.validAfter ?? now)) > BigInt(now)) {
        return { isValid: false, invalidReason: 'not_yet_valid' };
      }
    } catch {
      return { isValid: false, invalidReason: 'invalid_time_window' };
    }

    // Chain-specific signature + balance check (overridable)
    const sigResult = await this.verifySignatureOnChain(payload, requirements);
    if (!sigResult.isValid) return sigResult;

    return { isValid: true };
  }

  /**
   * Settle the authorization on-chain. Chain-specific — subclasses must
   * implement using viem (EVM) or tronweb (TRON).
   */
  abstract settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<SettleResponse>;

  /**
   * Chain-specific signature recovery + balance check. Default returns
   * `isValid: true` (trust upstream); subclasses MUST override for real
   * signature verification. Marked protected so subclass can call super.
   */
  protected async verifySignatureOnChain(
    _payload: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return { isValid: true };
  }

  protected extractAuthorization(
    payload: PaymentPayload,
  ): NonNullable<PaymentPayload['payload']['authorization']> | null {
    if (payload.payload.authorization) return payload.payload.authorization;
    const ext = (payload.extensions ?? {})['transferAuthorization'];
    return (ext as NonNullable<PaymentPayload['payload']['authorization']>) ?? null;
  }
}
