/**
 * Wallet interface — abstracts private-key-dependent operations.
 *
 * Implementations may hold a raw private key locally (PrivateKeyWallet)
 * or delegate to an external wallet service (AgentWalletAdapter).
 */
export interface Wallet {
  /** Return the wallet's public address (chain-native format). */
  getAddress(): string;

  /** Sign an arbitrary message, return signature hex. */
  signMessage(message: Uint8Array): Promise<string>;

  /** Sign EIP-712 typed data, return signature hex. */
  signTypedData(data: Record<string, unknown>): Promise<string>;

  /**
   * Sign a pre-built transaction.
   * @returns Hex string **without** `0x` prefix.
   *   - EVM: complete signed transaction hex (RLP-encoded)
   *   - TRON: signature hex only (to be attached to transaction)
   */
  signTransaction(tx: Record<string, unknown>): Promise<string>;
}
