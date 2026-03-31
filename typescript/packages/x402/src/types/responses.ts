/**
 * Response type definitions for x402 protocol
 */

import type { PaymentRequirements, PaymentPermitContext } from './payment.js';

/** Resource information */
export interface ResourceInfo {
  /** Resource URL */
  url?: string;
  /** Resource description */
  description?: string;
  /** MIME type */
  mimeType?: string;
}

/** Payment required response (402) */
export interface PaymentRequired {
  /** x402 protocol version */
  x402Version: number;
  /** Error message */
  error?: string;
  /** Resource information */
  resource?: ResourceInfo;
  /** Accepted payment options */
  accepts: PaymentRequirements[];
  /** Extensions */
  extensions?: {
    paymentPermitContext?: PaymentPermitContext;
    [key: string]: unknown;
  };
}

/** Verify response from facilitator */
export interface VerifyResponse {
  /** Whether the payment is valid */
  isValid: boolean;
  /** Invalid reason (if not valid) */
  invalidReason?: string;
}

/** Seller's ECDSA receipt signature for on-chain purchase logging */
export interface ReceiptSignatureData {
  /** 0x-prefixed 65-byte ECDSA signature (r+s+v) */
  signature: string;
  /** 0x-prefixed 32-byte keccak256 digest */
  digest: string;
  /** Listing ID in DataMarketplace */
  listingId: number;
  /** 8004 agent ID of the buyer (0 = anonymous) */
  buyerAgentId: number;
  /** 0x-prefixed bytes32 payment hash */
  paymentHash: string;
  /** Payment amount in token smallest unit */
  amount: number;
  /** EVM chain ID */
  chainId: number;
  /** PurchaseLog contract address */
  contractAddress: string;
}

/** Settlement response from facilitator */
export interface SettleResponse {
  /** Whether settlement succeeded */
  success: boolean;
  /** Transaction hash */
  transaction?: string;
  /** Network identifier */
  network?: string;
  /** Error reason (if failed) */
  errorReason?: string;
  /** Seller receipt signature for PurchaseLog on-chain proof */
  receiptSignature?: ReceiptSignatureData;
}

/** Supported response from facilitator */
export interface SupportedResponse {
  /** Supported payment kinds */
  kinds: Array<{
    x402Version: number;
    scheme: string;
    network: string;
  }>;
}

/** Fee quote response from facilitator */
export interface FeeQuoteResponse {
  /** Fee information */
  fee: {
    feeTo: string;
    feeAmount: string;
  };
  /** Pricing model */
  pricing: string;
  /** Payment scheme */
  scheme: string;
  /** Network identifier */
  network: string;
  /** Token asset address */
  asset: string;
  /** Quote expiry time */
  expiresAt?: number;
}
