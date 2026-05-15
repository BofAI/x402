/**
 * FacilitatorSigner — abstract base interface for facilitator-side signers.
 *
 * Mirrors Python `bankofai.x402.signers.facilitator.base.FacilitatorSigner`.
 *
 * Responsible for verifying signatures and executing on-chain transactions
 * on behalf of the facilitator (settle path).
 */

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

export type TypedDataTypes = Record<
  string,
  ReadonlyArray<{ name: string; type: string }>
>;

export interface TransactionReceipt {
  hash: string;
  blockNumber: string;
  status: 'confirmed' | 'failed';
}

export abstract class FacilitatorSigner {
  /** Facilitator's account address (Base58 on TRON, hex on EVM). */
  abstract getAddress(): string;

  /**
   * Verify EIP-712 / TIP-712 typed-data signature.
   *
   * @param address Expected signer address (Base58 on TRON; the impl normalizes).
   * @param domain EIP-712 domain.
   * @param types Type definitions (the impl injects `EIP712Domain` if needed).
   * @param message Signed message.
   * @param signature Hex signature (with or without `0x`).
   * @param primaryType Root type name.
   */
  abstract verifyTypedData(
    address: string,
    domain: TypedDataDomain,
    types: TypedDataTypes,
    message: Record<string, unknown>,
    signature: string,
    primaryType: string,
  ): Promise<boolean>;

  /**
   * Execute a contract write transaction. Returns the tx hash, or `null` on
   * broadcast failure (no exception — callers should treat null as failure).
   *
   * @param contractAddress Contract address (Base58 on TRON, hex on EVM).
   * @param abi Contract ABI (JSON string or array).
   * @param method Method name.
   * @param args Method arguments. For tuple structs, pass nested arrays/objects.
   * @param network Network identifier (e.g. `tron:nile`, `eip155:97`).
   */
  abstract writeContract(
    contractAddress: string,
    abi: string | unknown[],
    method: string,
    args: unknown[],
    network: string,
  ): Promise<string | null>;

  /**
   * Check ERC20/TRC20 token balance for an address.
   *
   * @param token Token contract address.
   * @param network Network identifier.
   * @param address Optional address (defaults to signer's address).
   */
  abstract checkBalance(
    token: string,
    network: string,
    address?: string,
  ): Promise<bigint>;

  /**
   * Wait for transaction confirmation (poll receipt).
   *
   * @param txHash Transaction hash.
   * @param network Network identifier.
   * @param timeoutMs Timeout in milliseconds (default 120s).
   */
  abstract waitForTransactionReceipt(
    txHash: string,
    network: string,
    timeoutMs?: number,
  ): Promise<TransactionReceipt>;
}
