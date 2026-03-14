// TIP-712 error reasons
export const INVALID_SCHEME = "invalid_exact_tron_scheme";
export const MISSING_TIP712_DOMAIN = "missing_tip712_domain";
export const NETWORK_MISMATCH = "invalid_exact_tron_network_mismatch";
export const INVALID_SIGNATURE = "invalid_exact_tron_payload_signature";
export const RECIPIENT_MISMATCH = "invalid_exact_tron_payload_recipient_mismatch";
export const VALID_BEFORE_EXPIRED = "invalid_exact_tron_payload_authorization_valid_before";
export const VALID_AFTER_FUTURE = "invalid_exact_tron_payload_authorization_valid_after";
export const VALUE_MISMATCH = "invalid_exact_tron_payload_authorization_value_mismatch";
export const INSUFFICIENT_FUNDS = "insufficient_funds";
export const INVALID_TRANSACTION_STATE = "invalid_transaction_state";
export const TRANSACTION_FAILED = "transaction_failed";

// Permit2-specific error reasons
export const INVALID_PERMIT2_SPENDER = "invalid_permit2_spender";
export const PERMIT2_RECIPIENT_MISMATCH = "invalid_permit2_recipient_mismatch";
export const INVALID_PERMIT2_FACILITATOR = "invalid_permit2_facilitator";
export const PERMIT2_DEADLINE_EXPIRED = "permit2_deadline_expired";
export const PERMIT2_NOT_YET_VALID = "permit2_not_yet_valid";
export const PERMIT2_AMOUNT_MISMATCH = "permit2_amount_mismatch";
export const PERMIT2_TOKEN_MISMATCH = "permit2_token_mismatch";
export const PERMIT2_INVALID_SIGNATURE = "invalid_permit2_signature";
export const PERMIT2_ALLOWANCE_REQUIRED = "permit2_allowance_required";
export const MISSING_PERMIT2_ADDRESS = "missing_permit2_address";
export const INVALID_TRC20_APPROVAL_FORMAT = "invalid_trc20_approval_format";
export const INVALID_TRC20_APPROVAL_FROM_MISMATCH = "invalid_trc20_approval_from_mismatch";
export const INVALID_TRC20_APPROVAL_ASSET_MISMATCH = "invalid_trc20_approval_asset_mismatch";
export const INVALID_TRC20_APPROVAL_SPENDER_NOT_PERMIT2 =
  "invalid_trc20_approval_spender_not_permit2";
export const INVALID_TRC20_APPROVAL_TX_MISSING_DATA = "invalid_trc20_approval_tx_missing_data";
export const INVALID_TRC20_APPROVAL_TX_WRONG_TARGET = "invalid_trc20_approval_tx_wrong_target";
export const INVALID_TRC20_APPROVAL_TX_WRONG_SELECTOR =
  "invalid_trc20_approval_tx_wrong_selector";
export const INVALID_TRC20_APPROVAL_TX_WRONG_SPENDER = "invalid_trc20_approval_tx_wrong_spender";
export const INVALID_TRC20_APPROVAL_TX_WRONG_AMOUNT = "invalid_trc20_approval_tx_wrong_amount";
export const INVALID_TRC20_APPROVAL_TX_INVALID_SIGNATURE =
  "invalid_trc20_approval_tx_invalid_signature";
