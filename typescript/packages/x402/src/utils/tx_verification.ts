/**
 * Transaction Verification Utilities
 *
 * Generic functionality to verify blockchain transaction results after the
 * facilitator reports settlement, ensuring on-chain transfers match expected
 * parameters. Mirrors `bankofai.x402.utils.tx_verification`.
 *
 * This module provides the **base contracts**. Chain-specific implementations
 * (TRON via tronweb, EVM via viem) subclass {@link BaseTransactionVerifier}
 * and plug in via {@link getVerifierForNetwork}.
 */

import type { PaymentPayload, PaymentRequirements } from '../types/index.js';

/** A single token transfer event extracted from a transaction. */
export interface TransferEvent {
  /** Token contract address. */
  token: string;
  /** Sender address. */
  fromAddr: string;
  /** Recipient address. */
  toAddr: string;
  /** Transfer amount in smallest unit (as a BigInt-safe string). */
  amount: string;
}

/** Outcome of {@link TransactionVerifier.verifyTransaction}. */
export interface TransactionVerificationResult {
  success: boolean;
  txHash: string;
  blockNumber?: string;
  errorReason?: string;
  transfers?: TransferEvent[];
  /** Whether the on-chain transaction status was "success". */
  statusVerified: boolean;
  /** Whether the payment transfer (amount + recipient) was verified. */
  paymentVerified: boolean;
  /** Whether the facilitator fee transfer was verified (when applicable). */
  feeVerified: boolean;
}

/**
 * Interface for transaction verification implementations. One per chain family.
 *
 * Wraps the chain's transaction-info / transfer-events RPC and applies the
 * canonical "did the right transfer happen" check.
 */
export interface TransactionVerifier {
  verifyTransaction(
    txHash: string,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<TransactionVerificationResult>;
  getTransactionTransfers(
    txHash: string,
    tokenAddress: string,
  ): Promise<TransferEvent[]>;
}

/** Generic transaction-info shape returned by chain-specific RPC adapters. */
export interface TransactionInfo {
  status?: string | number;
  blockNumber?: string;
}

/**
 * Abstract base class for transaction verifiers. Subclasses implement the
 * chain-specific RPC calls; the canonical verification flow lives here.
 *
 * Mirrors Python `BaseTransactionVerifier`. Like the Python base, the default
 * {@link verifyTransaction} only checks that the on-chain transaction
 * succeeded — chain-specific subclasses MAY override for richer transfer +
 * fee verification.
 */
export abstract class BaseTransactionVerifier implements TransactionVerifier {
  /** Chain-specific: pull transaction info (status, blockNumber) from RPC. */
  abstract getTransactionInfo(txHash: string): Promise<TransactionInfo>;

  /** Chain-specific: pull token transfer events from the transaction. */
  abstract getTransactionTransfers(
    txHash: string,
    tokenAddress: string,
  ): Promise<TransferEvent[]>;

  /** Chain-specific: normalize an address for equality comparison. */
  abstract normalizeAddress(address: string): string;

  /**
   * Canonical verification flow: pull transaction info, check status.
   *
   * Subclasses can override to additionally verify transfer amounts /
   * fee transfers — set `paymentVerified` / `feeVerified` accordingly.
   */
  async verifyTransaction(
    txHash: string,
    _payload: PaymentPayload,
    _requirements: PaymentRequirements,
  ): Promise<TransactionVerificationResult> {
    try {
      const info = await this.getTransactionInfo(txHash);
      const status = String(info.status ?? '').toLowerCase();
      if (status === 'failed' || status === '0' || status === '') {
        return {
          success: false,
          txHash,
          ...(info.blockNumber ? { blockNumber: info.blockNumber } : {}),
          errorReason: 'transaction_failed_on_chain',
          statusVerified: false,
          paymentVerified: false,
          feeVerified: false,
        };
      }
      return {
        success: true,
        txHash,
        ...(info.blockNumber ? { blockNumber: info.blockNumber } : {}),
        statusVerified: true,
        // Base impl doesn't check transfers — subclasses set these when they do.
        paymentVerified: false,
        feeVerified: false,
      };
    } catch (err) {
      return {
        success: false,
        txHash,
        errorReason: `verification_error: ${(err as Error).message}`,
        statusVerified: false,
        paymentVerified: false,
        feeVerified: false,
      };
    }
  }
}

/**
 * Registry of (network-prefix → verifier factory) entries.
 *
 * Chain-specific verifiers register themselves at module load (e.g. a TRON
 * verifier package would call `registerVerifierFactory('tron:', ...)`); the
 * core `@bankofai/x402` package ships no concrete verifiers itself.
 */
type VerifierFactory = (network: string, opts?: { rpcUrl?: string }) => TransactionVerifier;
const verifierFactories = new Map<string, VerifierFactory>();

/**
 * Register a verifier factory for a network prefix (e.g. `"tron:"`, `"eip155:"`).
 * Calls override any prior registration for the same prefix.
 */
export function registerVerifierFactory(prefix: string, factory: VerifierFactory): void {
  verifierFactories.set(prefix, factory);
}

/**
 * Resolve a {@link TransactionVerifier} for a given network.
 *
 * Throws if no factory has been registered for the network's prefix. Callers
 * that want optional verification (e.g. server middleware) should catch this
 * and skip verification gracefully.
 *
 * @example
 * ```ts
 * try {
 *   const verifier = getVerifierForNetwork('tron:nile');
 *   const result = await verifier.verifyTransaction(txHash, payload, requirements);
 * } catch {
 *   // No verifier registered → skip on-chain re-check (facilitator is trusted).
 * }
 * ```
 */
export function getVerifierForNetwork(
  network: string,
  opts?: { rpcUrl?: string },
): TransactionVerifier {
  for (const [prefix, factory] of verifierFactories) {
    if (network.startsWith(prefix)) {
      return factory(network, opts);
    }
  }
  throw new Error(`No transaction verifier registered for network: ${network}`);
}
