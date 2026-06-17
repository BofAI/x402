import type { Types } from "tronweb";

/**
 * Exact TRON payload containing a signed TRC-20 transfer transaction.
 */
export type ExactTronPayloadV2 = {
  transaction: SignedTronTransaction;
};

/**
 * Normalized TRC-20 transfer details extracted from a signed transaction.
 */
export type InspectedTronTransaction = {
  transactionId: string;
  payer: string;
  asset: string;
  payTo: string;
  amount: string;
  timestamp: number;
  expiration: number;
  feeLimit: number;
};

export type TronTransaction = Types.Transaction<Types.TriggerSmartContract>;
export type SignedTronTransaction = Types.SignedTransaction<Types.TriggerSmartContract>;
