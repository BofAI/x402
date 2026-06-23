/**
 * Adaptation-layer wallet contracts — BankofAI overlay, NOT from upstream.
 *
 * A chain-agnostic wallet hierarchy shared by the EVM and TRON mechanism
 * adapters (`create*Signer` factories). Mechanism packages cannot import each
 * other, so the common base lives here in core; this is a NEW overlay file and
 * does not touch any upstream core source.
 *
 * Hierarchy (role is the primary axis, chain refines via the generic / aliases):
 *
 *   Wallet                          identity only
 *   ├─ ClientWallet                 + signTypedData (+ optional signTransaction)
 *   └─ FacilitatorWallet<TTx>       + signTransaction(TTx)   (TTx is chain-specific)
 *
 * These are purely structural type contracts — implementing them does not couple
 * a consumer to `@bankofai/agent-wallet` (its `EvmSigner` / `TronSigner` happen
 * to satisfy them, as can a keystore, hardware wallet, etc.). Types are erased at
 * runtime, so this adds no dependency.
 */

/** Base: how to obtain the wallet's address (Base58 for TRON, 0x-hex for EVM). */
export interface Wallet {
  /** The wallet address. May be synchronous or asynchronous. */
  getAddress(): Promise<string> | string;
}

/**
 * Client role: signs EIP-712 / TIP-712 typed data for payment authorizations,
 * and optionally signs a one-time `approve(Permit2)` transaction.
 */
export interface ClientWallet extends Wallet {
  /**
   * Sign typed data, returning the signature hex. The `0x` prefix is optional —
   * adapters normalize it. Domain/message addresses must already be EVM hex.
   */
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<string>;
  /**
   * Optionally sign a transaction (e.g. the one-time Permit2 `approve`). When
   * absent, the signer stays sign-only and that flow is skipped. The return may
   * be a signature hex or a serialized/built transaction object.
   */
  signTransaction?(tx: Record<string, unknown>): Promise<string | Record<string, unknown>>;
}

/**
 * Facilitator role: signs settlement transactions for broadcast. The transaction
 * shape is chain-specific, so it is carried by the `TTx` type parameter — EVM
 * narrows it to typed EIP-1559 fields, TRON uses the default opaque record.
 */
export interface FacilitatorWallet<TTx = Record<string, unknown>> extends Wallet {
  /** Sign a (chain-specific) transaction; returns a signature hex or built tx. */
  signTransaction(tx: TTx): Promise<string | Record<string, unknown>>;
}
