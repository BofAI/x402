/**
 * Shared base for `exact` scheme server mechanisms.
 *
 * Mirrors Python `mechanisms._exact_base.base.ExactBaseServerMechanism`.
 *
 * Per-chain mechanisms (`evm/exact/server.ts`, `tron/exact/server.ts`)
 * subclass this and provide a {@link ChainAdapter}. The base handles:
 * - price parsing (delegate to {@link parsePrice})
 * - requirements enhancement (token name / version from registry)
 * - basic validation (network + address format)
 *
 * `verify_signature` requires on-chain or chain-specific signing libs — left
 * abstract here for subclasses to implement with their chain's tooling.
 */

import type { ChainAdapter } from './adapter.js';
import { parsePrice, findByAddress } from '../../tokens.js';
import type { ServerMechanism } from '../../server/types.js';
import type {
  PaymentPayload,
  PaymentPermit,
  PaymentRequirements,
} from '../../types/index.js';
import { SCHEME_EXACT } from './types.js';

export abstract class ExactBaseServerMechanism implements ServerMechanism {
  constructor(protected readonly adapter: ChainAdapter) {}

  scheme(): string {
    return SCHEME_EXACT;
  }

  async parsePrice(price: string, network: string) {
    return parsePrice(price, network);
  }

  /**
   * Attach token name + version to `extra` so clients have everything needed
   * to build the EIP-712 / TIP-712 typed-data domain.
   */
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
    if (!this.adapter.validateNetwork(requirements.network)) return false;
    if (!this.adapter.validateAddress(requirements.asset)) return false;
    if (!this.adapter.validateAddress(requirements.payTo)) return false;
    return true;
  }

  /**
   * Server-side signature verification. Chain-specific — subclasses must
   * implement using their chain's signature recovery primitives (viem for
   * EVM, tron-utils for TRON).
   *
   * For `exact`, the signed object is the `authorization` (ERC-3009-style).
   */
  abstract verifySignature(
    permit: PaymentPermit | null | undefined,
    signature: string,
    network: string,
  ): Promise<boolean>;

  /** Convenience hook to pull the authorization out of a payload. */
  protected extractAuthorization(
    payload: PaymentPayload,
  ): PaymentPayload['payload']['authorization'] | null {
    if (payload.payload.authorization) return payload.payload.authorization;
    const ext = (payload.extensions ?? {})['transferAuthorization'];
    return (ext as PaymentPayload['payload']['authorization']) ?? null;
  }
}
