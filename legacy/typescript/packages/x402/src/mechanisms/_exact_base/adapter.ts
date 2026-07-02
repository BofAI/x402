/**
 * ChainAdapter — pluggable per-chain primitives for the `exact` scheme.
 *
 * Mirrors Python `mechanisms._exact_base.base.ChainAdapter`. Subclasses
 * provide chain-specific parsing / validation / address normalization so
 * `ExactBase{Client,Server,Facilitator}Mechanism` can stay chain-agnostic.
 */

export interface ChainAdapter {
  /** Parse chain id from CAIP-2 network (e.g. `"eip155:97"` → `97`). */
  parseChainId(network: string): number;
  /** Check the CAIP-2 prefix is valid for this adapter (`"eip155:"` / `"tron:"`). */
  validateNetwork(network: string): boolean;
  /** Format check (no on-chain lookup). */
  validateAddress(address: string): boolean;
  /** Canonicalize for storage / comparison (lowercase EVM, Base58 TRON, ...). */
  normalizeAddress(address: string): string;
  /**
   * Convert to the address representation used inside EIP-712 / TIP-712 typed
   * data (0x-prefixed hex on both chains). Used by signing path.
   */
  toSigningAddress(address: string): string;
}
