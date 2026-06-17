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

// --- GasFree types ---

/**
 * GasFree permit message fields (GasFreeController `PermitTransfer`).
 * Addresses are TRON Base58Check; numeric fields are decimal strings.
 */
export type GasFreeMessage = {
  /** TRC-20 token being transferred. */
  token: string;
  /** GasFree service provider (also the fee collector / caller). */
  serviceProvider: string;
  /** The paying user (buyer). */
  user: string;
  /** The payment recipient. */
  receiver: string;
  /** Payment amount in the token's smallest unit. */
  value: string;
  /** Maximum fee the user authorizes (smallest unit). */
  maxFee: string;
  /** Unix-seconds deadline. */
  deadline: string;
  /** GasFree permit version (currently "1"). */
  version: string;
  /** GasFree account nonce. */
  nonce: string;
};

/**
 * Payload for the `exact_gasfree` scheme.
 * Self-contained: carries the signed GasFree message plus the user's GasFree
 * wallet address (where the funds actually sit) for balance preflight.
 */
export type ExactGasFreePayload = {
  signature: `0x${string}`;
  gasfree: GasFreeMessage;
  /** The user's GasFree (smart-account) address, Base58Check. */
  gasfreeAddress: string;
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
