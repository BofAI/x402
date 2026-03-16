/**
 * X402Client - Core payment client for x402 protocol
 * 
 * Manages payment mechanism registry and coordinates payment flows.
 */

import { ExactGasFreeClientMechanism } from '../mechanisms/exactGasfree.js';
import { GasFreeAPIClient } from '../utils/gasfree.js';
import type {
  PaymentRequirements,
  PaymentPayload,
  PaymentPermitContext,
} from '../types/index.js';
import { DefaultTokenSelectionStrategy } from './tokenSelection.js';
import type { TokenSelectionStrategy } from './tokenSelection.js';
import { UnsupportedNetworkError } from '../errors.js';

/** Client mechanism interface */
export interface ClientMechanism {
  /** Get payment scheme name */
  scheme(): string;

  /**
   * Return the signer used by this mechanism, if any.
   * Used by X402Client to auto-register balance-aware policies.
   */
  getSigner?(): ClientSigner;
  
  /** Create payment payload */
  createPaymentPayload(
    requirements: PaymentRequirements,
    resource: string,
    extensions?: { paymentPermitContext?: PaymentPermitContext }
  ): Promise<PaymentPayload>;
}

/** Client signer interface */
export interface ClientSigner {
  /** Get signer address */
  getAddress(): string;
  
  /** Sign raw message */
  signMessage(message: Uint8Array): Promise<string>;
  
  /** Sign typed data (EIP-712) */
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, unknown>,
    message: Record<string, unknown>,
    primaryType: string
  ): Promise<string>;
  
  /** Check token balance */
  checkBalance(token: string, network: string, address?: string): Promise<bigint>;

  /** Check token allowance */
  checkAllowance(token: string, amount: bigint, network: string): Promise<bigint>;
  
  /** Ensure sufficient allowance */
  ensureAllowance(
    token: string,
    amount: bigint,
    network: string,
    mode?: 'auto' | 'interactive' | 'skip'
  ): Promise<boolean>;
}

/** Payment requirements selector function */
export type PaymentRequirementsSelector = (
  requirements: PaymentRequirements[]
) => PaymentRequirements;

/**
 * Policy that filters or reorders payment requirements.
 *
 * Policies are applied in order after mechanism filtering and before token selection.
 * Return a subset (or reordered list) of the input requirements.
 */
export interface PaymentPolicy {
  apply(requirements: PaymentRequirements[]): PaymentRequirements[] | Promise<PaymentRequirements[]>;
}

/** Filter options for selecting payment requirements */
export interface PaymentRequirementsFilter {
  scheme?: string;
  network?: string;
  maxAmount?: string;
}

/** Registered mechanism entry */
interface MechanismEntry {
  pattern: string;
  mechanism: ClientMechanism;
  priority: number;
}

/**
 * X402Client - Core payment client
 * 
 * Manages payment mechanisms and coordinates payment flows.
 */
export class X402Client {
  private mechanisms: MechanismEntry[] = [];
  private policies: PaymentPolicy[] = [];
  private tokenStrategy?: TokenSelectionStrategy;

  constructor(options?: { tokenStrategy?: TokenSelectionStrategy }) {
    this.tokenStrategy = options?.tokenStrategy;
  }

  /**
   * Register a payment policy
   *
   * Policies are applied in order after mechanism filtering
   * and before token selection.
   *
   * @param policy - Function that filters/reorders payment requirements
   * @returns this for method chaining
   */
  registerPolicy(policy: PaymentPolicy | { new(client: X402Client): PaymentPolicy }): X402Client {
    const instance = typeof policy === 'function'
      ? new (policy as { new(client: X402Client): PaymentPolicy })(this)
      : policy;
    this.policies.push(instance);
    return this;
  }

  /**
   * Resolve a signer from registered mechanisms for the given scheme+network.
   */
  resolveSigner(scheme: string, network: string): ClientSigner | null {
    const mechanism = this.findMechanism(scheme, network);
    return mechanism?.getSigner?.() ?? null;
  }

  /**
   * Register payment mechanism for network pattern
   * 
   * @param networkPattern - Network pattern (e.g. "eip155:*", "tron:shasta")
   * @param mechanism - Payment mechanism instance
   * @returns this for method chaining
   */
  register(networkPattern: string, mechanism: ClientMechanism): X402Client {
    const priority = this.calculatePriority(networkPattern);
    this.mechanisms.push({
      pattern: networkPattern,
      mechanism,
      priority,
    });
    this.mechanisms.sort((a, b) => b.priority - a.priority);
    return this;
  }

  /**
   * Register built-in GasFree mechanism for TRON
   * 
   * @param signer - Client signer instance
   * @param clients - Optional GasFree API clients per network
   * @returns this for method chaining
   */
  registerGasFree(signer: ClientSigner, clients: Record<string, GasFreeAPIClient> = {}): X402Client {
    return this.register('tron:*', new ExactGasFreeClientMechanism(signer, clients));
  }

  /**
   * Select payment requirements from available options
   * 
   * @param accepts - Available payment requirements
   * @param filters - Optional filters
   * @returns Selected payment requirements
   */
  async selectPaymentRequirements(
    accepts: PaymentRequirements[],
    filters?: PaymentRequirementsFilter
  ): Promise<PaymentRequirements> {
    let candidates = accepts;

    if (filters?.scheme) {
      candidates = candidates.filter(r => r.scheme === filters.scheme);
    }

    if (filters?.network) {
      candidates = candidates.filter(r => r.network === filters.network);
    }

    if (filters?.maxAmount) {
      const max = BigInt(filters.maxAmount);
      candidates = candidates.filter(r => BigInt(r.amount) <= max);
    }

    candidates = candidates.filter(r => this.findMechanism(r.scheme, r.network) !== null);

    for (const policy of this.policies) {
      candidates = await policy.apply(candidates);
    }

    if (candidates.length === 0) {
      throw new UnsupportedNetworkError('No supported payment requirements found');
    }

    if (this.tokenStrategy) {
      return this.tokenStrategy.select(candidates);
    }

    return new DefaultTokenSelectionStrategy().select(candidates);
  }

  /**
   * Create payment payload for given requirements
   * 
   * @param requirements - Selected payment requirements
   * @param resource - Resource URL
   * @param extensions - Optional extensions
   * @returns Payment payload
   */
  async createPaymentPayload(
    requirements: PaymentRequirements,
    resource: string,
    extensions?: { paymentPermitContext?: PaymentPermitContext }
  ): Promise<PaymentPayload> {
    const mechanism = this.findMechanism(requirements.scheme, requirements.network);
    if (!mechanism) {
      throw new UnsupportedNetworkError(
        `No mechanism registered for scheme=${requirements.scheme}, network=${requirements.network}`
      );
    }

    return mechanism.createPaymentPayload(requirements, resource, extensions);
  }

  /**
   * Handle payment required response
   * 
   * @param accepts - Available payment requirements
   * @param resource - Resource URL
   * @param extensions - Optional extensions
   * @param selector - Optional custom selector
   * @returns Payment payload
   */
  async handlePayment(
    accepts: PaymentRequirements[],
    resource: string,
    extensions?: Record<string, unknown>,
    selector?: PaymentRequirementsSelector
  ): Promise<PaymentPayload> {
    const requirements = selector
      ? selector(accepts)
      : await this.selectPaymentRequirements(accepts);

    return this.createPaymentPayload(requirements, resource, extensions);
  }

  /**
   * Find mechanism for scheme and network
   */
  private findMechanism(scheme: string, network: string): ClientMechanism | null {
    for (const entry of this.mechanisms) {
      if (entry.mechanism.scheme() === scheme && this.matchPattern(entry.pattern, network)) {
        return entry.mechanism;
      }
    }
    return null;
  }

  /**
   * Match network with pattern
   */
  private matchPattern(pattern: string, network: string): boolean {
    if (pattern === network) return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1);
      return network.startsWith(prefix);
    }
    return false;
  }

  /**
   * Calculate priority for pattern (more specific = higher priority)
   */
  private calculatePriority(pattern: string): number {
    if (pattern.endsWith(':*')) return 1;
    return 10;
  }
}
