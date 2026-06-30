/**
 * Shared base for `exact_permit` scheme server mechanisms.
 *
 * Mirrors Python `mechanisms._exact_permit_base.server.BaseExactPermitServerMechanism`.
 */

import { findByAddress, parsePrice } from '../../tokens.js';
import type { ServerMechanism } from '../../server/types.js';
import type {
  PaymentPermit,
  PaymentRequirements,
} from '../../types/index.js';

const SCHEME_EXACT_PERMIT = 'exact_permit';

export abstract class BaseExactPermitServerMechanism implements ServerMechanism {
  /** CAIP-2 prefix this mechanism handles (`"eip155:"` or `"tron:"`). */
  protected abstract getNetworkPrefix(): string;
  /** Format-only address validation (no on-chain lookup). */
  protected abstract validateAddressFormat(address: string): boolean;

  scheme(): string {
    return SCHEME_EXACT_PERMIT;
  }

  async parsePrice(price: string, network: string) {
    return parsePrice(price, network);
  }

  async enhancePaymentRequirements(
    requirements: PaymentRequirements,
    _deliveryMode: string,
  ): Promise<PaymentRequirements> {
    const token = findByAddress(requirements.network, requirements.asset);
    if (!token) return requirements;
    return {
      ...requirements,
      extra: {
        ...(requirements.extra ?? {}),
        name: token.name,
        ...(token.version ? { version: token.version } : {}),
      },
    };
  }

  validatePaymentRequirements(requirements: PaymentRequirements): boolean {
    if (!requirements.network.startsWith(this.getNetworkPrefix())) return false;
    if (!this.validateAddressFormat(requirements.asset)) return false;
    if (!this.validateAddressFormat(requirements.payTo)) return false;
    return true;
  }

  /**
   * Verify the EIP-712 / TIP-712 permit signature server-side.
   *
   * TODO(v0.6.0b): port Python's `verify_signature` —
   * - hash the typed-data per chain
   * - recover signer from `signature`
   * - compare to `permit.buyer`
   *
   * Until then returns `true` and defers to the facilitator's authoritative
   * verification. The interface is present so middleware can call it
   * uniformly when full impl lands.
   */
  async verifySignature(
    _permit: PaymentPermit | null | undefined,
    _signature: string,
    _network: string,
  ): Promise<boolean> {
    return true;
  }
}
