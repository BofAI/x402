/**
 * Payment-related type definitions for x402 protocol
 */

/** Delivery mode for payment */
export type DeliveryKind = 'PAYMENT_ONLY';

/** Payment permit metadata */
export interface PermitMeta {
  /** Delivery type: PAYMENT_ONLY */
  kind: DeliveryKind;
  /** Business order ID for reconciliation */
  paymentId: string;
  /** Idempotency key (isolated by owner address) */
  nonce: string;
  /** Effective time (Unix seconds) */
  validAfter: number;
  /** Expiry time (Unix seconds) */
  validBefore: number;
}

/** Payment information */
export interface Payment {
  /** Payment token address */
  payToken: string;
  /** Maximum deductible amount */
  payAmount: string;
  /** Primary recipient address */
  payTo: string;
}

/** Fee information */
export interface Fee {
  /** Fee recipient address */
  feeTo: string;
  /** Fee amount */
  feeAmount: string;
}

/** Payment permit structure */
export interface PaymentPermit {
  /** Permit metadata */
  meta: PermitMeta;
  /** Payer address (signer) */
  buyer: string;
  /** Caller address (who can call permitTransferFrom) */
  caller: string;
  /** Payment information */
  payment: Payment;
  /** Fee information */
  fee: Fee;
}

/** Payment requirements from server */
export interface PaymentRequirements {
  /** Payment scheme (e.g., "exact", "upto") */
  scheme: string;
  /** Network identifier (e.g., "tron:shasta", "eip155:8453") */
  network: string;
  /** Payment amount (in smallest unit) */
  amount: string;
  /** Payment asset address */
  asset: string;
  /** Recipient address */
  payTo: string;
  /** Maximum timeout in seconds */
  maxTimeoutSeconds?: number;
  /** Extra information */
  extra?: PaymentRequirementsExtra;
}

/** Extra information in payment requirements */
export interface PaymentRequirementsExtra {
  /** Token name */
  name?: string;
  /** Token version */
  version?: string;
  /** Fee information */
  fee?: {
    facilitatorId?: string;
    feeTo: string;
    feeAmount: string;
    caller?: string;
  };
}

/** Payment permit context from extensions */
export interface PaymentPermitContext {
  meta: {
    kind: DeliveryKind;
    paymentId: string;
    nonce: string;
    validAfter: number;
    validBefore: number;
  };
}

/** Payment payload sent by client */
export interface PaymentPayload {
  /** x402 protocol version */
  x402Version: number;
  /** Resource information */
  resource?: {
    url?: string;
    description?: string;
    mimeType?: string;
  };
  /** Accepted payment requirements */
  accepted: PaymentRequirements;
  /** Payment payload data */
  payload: {
    /** Buyer's EIP-712 signature */
    signature: string;
    /** Payment permit */
    paymentPermit: PaymentPermit;
  };
  /** Extensions */
  extensions?: Record<string, unknown>;
}
