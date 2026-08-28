// TIP-712 error reasons
export const INVALID_SCHEME = "invalid_exact_tron_scheme";
export const MISSING_TIP712_DOMAIN = "missing_tip712_domain";
export const NETWORK_MISMATCH = "invalid_exact_tron_network_mismatch";
export const INVALID_ASSET_TRANSFER_METHOD = "invalid_exact_tron_asset_transfer_method";
export const INVALID_SIGNATURE = "invalid_exact_tron_payload_signature";
export const RECIPIENT_MISMATCH = "invalid_exact_tron_payload_recipient_mismatch";
export const VALID_BEFORE_EXPIRED = "invalid_exact_tron_payload_authorization_valid_before";
export const VALID_AFTER_FUTURE = "invalid_exact_tron_payload_authorization_valid_after";
export const VALUE_MISMATCH = "invalid_exact_tron_payload_authorization_value_mismatch";
export const INSUFFICIENT_FUNDS = "insufficient_funds";
export const INVALID_TRANSACTION_STATE = "invalid_transaction_state";
export const TRANSACTION_FAILED = "transaction_failed";
export const CHAIN_READ_FAILED = "chain_read_failed";

// Permit2-specific error reasons
export const INVALID_PERMIT2_SPENDER = "invalid_permit2_spender";
export const PERMIT2_RECIPIENT_MISMATCH = "invalid_permit2_recipient_mismatch";
// Retained for the upcoming `upto` path: its 3-field witness binds a facilitator
// (`msg.sender == witness.facilitator`) that the facilitator must validate.
// Unused by the 2-field `exact` witness.
export const INVALID_PERMIT2_FACILITATOR = "invalid_permit2_facilitator";
export const PERMIT2_DEADLINE_EXPIRED = "permit2_deadline_expired";
export const PERMIT2_NOT_YET_VALID = "permit2_not_yet_valid";
export const PERMIT2_AMOUNT_MISMATCH = "permit2_amount_mismatch";
export const PERMIT2_TOKEN_MISMATCH = "permit2_token_mismatch";
export const PERMIT2_INVALID_SIGNATURE = "invalid_permit2_signature";
export const PERMIT2_ALLOWANCE_REQUIRED = "permit2_allowance_required";
export const MISSING_PERMIT2_ADDRESS = "missing_permit2_address";

// TRC-20 Approval Resource Sponsoring errors
export const APPROVAL_EXTENSION_INVALID = "approval_extension_invalid";
export const APPROVAL_SIGNATURE_INVALID = "approval_signature_invalid";
export const APPROVAL_SEMANTICS_INVALID = "approval_semantics_invalid";
export const APPROVAL_RESET_REQUIRED = "approval_reset_required";
export const SPONSOR_RUNTIME_UNAVAILABLE = "sponsor_runtime_unavailable";
export const SPONSOR_POLICY_DENIED = "sponsor_policy_denied";
export const SPONSOR_EXECUTION_FAILED = "sponsor_execution_failed";
