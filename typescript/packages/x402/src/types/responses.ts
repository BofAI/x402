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
}

/** Supported response from facilitator */
export interface SupportedResponse {
  /** Supported payment kinds */
  kinds: Array<{
    x402Version: number;
    scheme: string;
    network: string;
  }>;
  /** Fee configuration */
  fee: {
    feeTo: string;
    pricing: 'per_accept' | 'flat';
  };
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
