/**
 * Shared base for `exact` scheme facilitator mechanisms.
 *
 * Mirrors Python `mechanisms._exact_base.base.ExactBaseFacilitatorMechanism`.
 *
 * Per-chain subclasses provide a {@link ChainAdapter}. The base handles:
 * - structural verification (asset / payTo / value match, time window)
 * - ERC-3009 EIP-712 signature recovery via the injected FacilitatorSigner
 * - `transferWithAuthorization` settle + receipt polling
 *
 * Subclasses ONLY need to override:
 * - `settlePaymentOnly()` — chain-specific contract call dispatch (TRON
 *   triggerSmartContract vs EVM viem writeContract)
 */

import type { ChainAdapter } from './adapter.js';
import type { FacilitatorMechanism } from '../../facilitator/x402Facilitator.js';
import type {
  FeeQuoteResponse,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  TransferAuthorization,
  VerifyResponse,
} from '../../types/index.js';
import { FacilitatorSigner } from '../../signers/facilitator/base.js';
import { findByAddress } from '../../tokens.js';
import {
  SCHEME_EXACT,
  TRANSFER_AUTH_EIP712_TYPES,
  TRANSFER_AUTH_PRIMARY_TYPE,
} from './types.js';

const FEE_QUOTE_EXPIRY_SECONDS = 300;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export abstract class ExactBaseFacilitatorMechanism
  implements FacilitatorMechanism
{
  protected readonly signer: FacilitatorSigner;
  protected readonly adapter: ChainAdapter;
  protected readonly allowedTokens: ReadonlySet<string> | null;

  constructor(
    signer: FacilitatorSigner,
    adapter: ChainAdapter,
    options: { allowedTokens?: ReadonlyArray<string> } = {},
  ) {
    this.signer = signer;
    this.adapter = adapter;
    this.allowedTokens = options.allowedTokens
      ? new Set(options.allowedTokens.map((t) => adapter.normalizeAddress(t)))
      : null;
  }

  scheme(): string {
    return SCHEME_EXACT;
  }

  /**
   * `exact` scheme has no facilitator fee (single transfer per authorization).
   * Returns `feeAmount: "0"` for compatibility with the `/fee/quote` flow.
   */
  async feeQuote(
    accept: PaymentRequirements,
    _context?: Record<string, unknown>,
  ): Promise<FeeQuoteResponse | null> {
    return {
      fee: { feeTo: this.signer.getAddress(), feeAmount: '0' },
      pricing: 'flat',
      scheme: accept.scheme,
      network: accept.network,
      asset: accept.asset,
      expiresAt: Math.floor(Date.now() / 1000) + FEE_QUOTE_EXPIRY_SECONDS,
    } as unknown as FeeQuoteResponse;
  }

  /**
   * Off-chain verify: structural + timing checks, then EIP-712 signature
   * recovery against the token's ERC-3009 domain.
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const auth = this.extractAuthorization(payload);
    if (!auth) {
      return { isValid: false, invalidReason: 'missing_transfer_authorization' };
    }

    const validationError = this.validateAuthorization(auth, requirements);
    if (validationError) {
      return { isValid: false, invalidReason: validationError };
    }

    const validSig = await this.verifySignature(
      auth,
      payload.payload.signature,
      requirements,
    );
    if (!validSig) {
      return { isValid: false, invalidReason: 'invalid_signature' };
    }
    return { isValid: true };
  }

  /**
   * Settle: verify, then submit `transferWithAuthorization(v,r,s)` via the
   * subclass-provided `settlePaymentOnly`, then poll the receipt.
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

    const auth = this.extractAuthorization(payload)!;
    const signature = payload.payload.signature;

    let txHash: string | null;
    try {
      txHash = await this.settlePaymentOnly(auth, signature, requirements);
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
  // Protected helpers
  // -------------------------------------------------------------------------

  protected validateAuthorization(
    auth: TransferAuthorization,
    requirements: PaymentRequirements,
  ): string | null {
    const norm = (s: string) => this.adapter.normalizeAddress(s);

    if (
      this.allowedTokens !== null &&
      !this.allowedTokens.has(norm(requirements.asset))
    ) {
      return 'token_not_allowed';
    }

    try {
      if (BigInt(auth.value) < BigInt(requirements.amount)) {
        return 'amount_mismatch';
      }
    } catch {
      return 'invalid_value';
    }

    if (norm(auth.to) !== norm(requirements.payTo)) {
      return 'payto_mismatch';
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      if (BigInt(auth.validBefore) < BigInt(now)) return 'expired';
      if (BigInt(auth.validAfter) > BigInt(now)) return 'not_yet_valid';
    } catch {
      return 'invalid_time_window';
    }
    return null;
  }

  /**
   * Verify the buyer's ERC-3009 EIP-712 signature against the token's domain.
   *
   * Domain shape (ERC-3009): `{ name, version, chainId, verifyingContract: <token> }`.
   * Token name / version come from the SDK token registry; addresses are
   * converted to signing format (0x EVM hex) for both EVM and TRON.
   */
  protected async verifySignature(
    auth: TransferAuthorization,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<boolean> {
    const adapter = this.adapter;
    const chainId = adapter.parseChainId(requirements.network);
    const tokenInfo = findByAddress(requirements.network, requirements.asset);
    const tokenName = tokenInfo?.name ?? 'Unknown Token';
    const tokenVersion = tokenInfo?.version ?? '1';

    const domain = {
      name: tokenName,
      version: tokenVersion,
      chainId,
      verifyingContract: adapter.toSigningAddress(requirements.asset),
    };
    const message = {
      from: adapter.toSigningAddress(auth.from),
      to: adapter.toSigningAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      // viem accepts hex string for bytes32 types
      nonce: auth.nonce.startsWith('0x') ? auth.nonce : `0x${auth.nonce}`,
    };

    return this.signer.verifyTypedData(
      adapter.toSigningAddress(auth.from),
      domain,
      TRANSFER_AUTH_EIP712_TYPES as unknown as Record<
        string,
        ReadonlyArray<{ name: string; type: string }>
      >,
      message,
      signature,
      TRANSFER_AUTH_PRIMARY_TYPE,
    );
  }

  /**
   * Split a 65-byte signature into v / r / s for the (v, r, s) variant of
   * `transferWithAuthorization`. v is normalized to 27 or 28 (some signers
   * return 0 / 1).
   */
  protected splitSignature(signature: string): {
    v: number;
    r: `0x${string}`;
    s: `0x${string}`;
  } {
    const sigBytes = hexToBytes(signature);
    if (sigBytes.length !== 65) {
      throw new Error(`Invalid signature length: ${sigBytes.length}`);
    }
    const r =
      '0x' +
      Array.from(sigBytes.slice(0, 32))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    const s =
      '0x' +
      Array.from(sigBytes.slice(32, 64))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    let v = sigBytes[64]!;
    if (v < 27) v += 27;
    return { v, r: r as `0x${string}`, s: s as `0x${string}` };
  }

  protected extractAuthorization(
    payload: PaymentPayload,
  ): TransferAuthorization | null {
    if (payload.payload.authorization) return payload.payload.authorization;
    const ext = (payload.extensions ?? {})['transferAuthorization'];
    return (ext as TransferAuthorization) ?? null;
  }

  /**
   * Submit the authorization on-chain. Chain-specific — subclasses MUST
   * implement (TRON via tronweb, EVM via viem).
   *
   * Returns the tx hash on broadcast success, or `null` on broadcast failure.
   */
  protected abstract settlePaymentOnly(
    auth: TransferAuthorization,
    signature: string,
    requirements: PaymentRequirements,
  ): Promise<string | null>;
}
