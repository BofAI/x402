/**
 * Asset transfer methods for the exact TRON scheme.
 * - eip3009: Uses TransferWithAuthorization via TIP-712 (TRON equivalent of EIP-3009)
 * - permit2: Uses Permit2 + x402Permit2Proxy — universal fallback for any TRC-20
 */
export type AssetTransferMethod = "eip3009" | "permit2";

// --- TIP-712 (TransferWithAuthorization) types ---

/**
 * TransferWithAuthorization payload for TRON.
 * Equivalent to EIP-3009 on EVM networks.
 */
export type ExactEIP3009Payload = {
  signature?: `0x${string}`;
  authorization: {
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: `0x${string}`;
  };
};

// --- Permit2 types ---

/**
 * Permit2 witness data structure for TRON.
 * Matches the Witness struct in x402Permit2Proxy contract.
 * Upper time bound is enforced by Permit2's `deadline` field, not a witness field.
 */
export type Permit2Witness = {
  to: `0x${string}`;
  facilitator: `0x${string}`;
  validAfter: string;
};

/**
 * Permit2 authorization parameters for TRON.
 */
export type Permit2Authorization = {
  permitted: {
    token: `0x${string}`;
    amount: string;
  };
  spender: `0x${string}`;
  nonce: string;
  deadline: string;
  witness: Permit2Witness;
};

/**
 * Permit2 payload for tokens using the Permit2 + x402Permit2Proxy flow on TRON.
 */
export type ExactPermit2Payload = {
  signature: `0x${string}`;
  permit2Authorization: Permit2Authorization & {
    from: `0x${string}`;
  };
};

// --- Union and type guards ---

/**
 * Union of all exact TRON payload types.
 */
export type ExactTronPayload = ExactEIP3009Payload | ExactPermit2Payload;

/**
 * Type guard to check if a payload is a Permit2 payload.
 * Permit2 payloads have a `permit2Authorization` field.
 *
 * @param payload - The payload to check.
 * @returns True if the payload is an ExactPermit2Payload.
 */
export function isPermit2Payload(payload: ExactTronPayload): payload is ExactPermit2Payload {
  return "permit2Authorization" in payload;
}

/**
 * Type guard to check if a payload is a TransferWithAuthorization payload.
 * EIP-3009-style payloads have an `authorization` field.
 *
 * @param payload - The payload to check.
 * @returns True if the payload is an ExactEIP3009Payload.
 */
export function isEIP3009Payload(payload: ExactTronPayload): payload is ExactEIP3009Payload {
  return "authorization" in payload;
}
