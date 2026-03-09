/**
 * TronWeb type definitions for x402 protocol
 */

export type Hex = `0x${string}`;

/** EIP-712 Domain type */
export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number | string;
  verifyingContract?: string;
}

/** EIP-712 Type definition */
export interface TypedDataField {
  name: string;
  type: string;
}

/** TronWeb instance type (from tronweb package) */
export interface TronWeb {
  address: {
    fromPrivateKey(privateKey: string): string;
    toHex(address: string): string;
    fromHex(address: string): string;
  };
  trx: {
    sign(transaction: unknown, privateKey?: string): Promise<unknown>;
    signMessageV2(message: string, privateKey?: string): Promise<string>;
    /** TIP-712 typed data signing (stable API) */
    signTypedData(
      domain: TypedDataDomain,
      types: Record<string, TypedDataField[]>,
      value: Record<string, unknown>,
      privateKey?: string
    ): Promise<string>;
    /** TIP-712 typed data signing (legacy API, kept for backward compatibility) */
    _signTypedData(
      domain: TypedDataDomain,
      types: Record<string, TypedDataField[]>,
      value: Record<string, unknown>,
      privateKey?: string
    ): Promise<string>;
    /** Broadcast signed transaction */
    sendRawTransaction(signedTransaction: unknown): Promise<{ result: boolean; txid: string }>;
    /** Get transaction info by txid */
    getTransactionInfo(txid: string): Promise<{ blockNumber?: number; receipt?: { result: string } }>;
  };
  transactionBuilder: {
    triggerSmartContract(
      contractAddress: string,
      functionSelector: string,
      options: Record<string, unknown>,
      parameters: unknown[],
      issuerAddress: string
    ): Promise<{ transaction: unknown; result: { result: boolean } }>;
    triggerConstantContract(
      contractAddress: string,
      functionSelector: string,
      options: Record<string, unknown>,
      parameters: unknown[],
      issuerAddress?: string
    ): Promise<{
      result: { result: boolean };
      constant_result?: string[];
    }>;
  };
  contract(): {
    at(address: string): Promise<unknown>;
  };
  defaultPrivateKey?: string;
}

/** TRON network chain IDs */
export const TRON_CHAIN_IDS = {
  mainnet: 728126428,
  shasta: 2494104990,
  nile: 3448148188,
} as const;

export type TronNetwork = keyof typeof TRON_CHAIN_IDS;
