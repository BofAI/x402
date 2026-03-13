"""TRON constants for the exact payment scheme."""

from typing import Any

# TRON chain IDs for TIP-712 signing
TRON_CHAIN_IDS: dict[str, int] = {
    "tron:mainnet": 728126428,  # 0x2b6653dc
    "tron:shasta": 2494104990,  # 0x94a9059e
    "tron:nile": 3448148188,  # 0xcd8690dc
}

# Default stablecoins per network (USDT)
TRON_DEFAULT_ASSETS: dict[str, dict[str, Any]] = {
    "tron:mainnet": {
        "address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "name": "Tether USD",
        "version": "1",
        "decimals": 6,
    },
    "tron:nile": {
        "address": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        "name": "Tether USD",
        "version": "1",
        "decimals": 6,
    },
    "tron:shasta": {
        "address": "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
        "name": "Tether USD",
        "version": "1",
        "decimals": 6,
    },
}

# TIP-712 type definitions for TransferWithAuthorization
AUTHORIZATION_TYPES: dict[str, list[dict[str, str]]] = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ]
}

SCHEME_EXACT = "exact"
DEFAULT_FEE_LIMIT_SUN = 1_000_000_000  # 1000 TRX

# Error messages
ERR_INVALID_SCHEME = "invalid_scheme"
ERR_MISSING_TIP712_DOMAIN = "missing_tip712_domain"
ERR_NETWORK_MISMATCH = "network_mismatch"
ERR_INVALID_SIGNATURE = "invalid_signature"
ERR_RECIPIENT_MISMATCH = "recipient_mismatch"
ERR_VALID_BEFORE_EXPIRED = "valid_before_expired"
ERR_VALID_AFTER_FUTURE = "valid_after_future"
ERR_VALUE_MISMATCH = "value_mismatch"
ERR_INSUFFICIENT_FUNDS = "insufficient_funds"
ERR_TRANSACTION_FAILED = "transaction_failed"
ERR_INVALID_TRANSACTION_STATE = "invalid_transaction_state"
ERR_UNKNOWN_NETWORK = "unknown_network"

# Permit2-specific errors
ERR_MISSING_PERMIT2_ADDRESS = "missing_permit2_address"
ERR_INVALID_PERMIT2_SPENDER = "invalid_permit2_spender"
ERR_PERMIT2_RECIPIENT_MISMATCH = "permit2_recipient_mismatch"
ERR_INVALID_PERMIT2_FACILITATOR = "invalid_permit2_facilitator"
ERR_PERMIT2_DEADLINE_EXPIRED = "permit2_deadline_expired"
ERR_PERMIT2_NOT_YET_VALID = "permit2_not_yet_valid"
ERR_PERMIT2_AMOUNT_MISMATCH = "permit2_amount_mismatch"
ERR_PERMIT2_TOKEN_MISMATCH = "permit2_token_mismatch"
ERR_PERMIT2_INVALID_SIGNATURE = "permit2_invalid_signature"
ERR_PERMIT2_ALLOWANCE_REQUIRED = "permit2_allowance_required"

# Permit2 contract addresses per TRON network
PERMIT2_ADDRESSES: dict[str, str] = {
    "tron:mainnet": "TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9",
    "tron:nile": "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
}

# x402ExactPermit2Proxy contract addresses
X402_PERMIT2_PROXY_ADDRESSES: dict[str, str] = {
    "tron:mainnet": "TSm6MSWHHBeABh22uqX7SU7QUweav4Cyy6",
    "tron:nile": "TCd2ZSwbJBAdgFfP5d3gkhKcGs47WNZLLi",
}

# x402UptoPermit2Proxy contract addresses
X402_UPTO_PERMIT2_PROXY_ADDRESSES: dict[str, str] = {
    "tron:mainnet": "TGHEYAovw8fZz1bgnVgRtgrdGLbagFZYq5",
    "tron:nile": "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR",
}

# TIP-712 type definitions for Permit2 PermitWitnessTransferFrom
PERMIT2_WITNESS_TYPES: dict[str, list[dict[str, str]]] = {
    "PermitWitnessTransferFrom": [
        {"name": "permitted", "type": "TokenPermissions"},
        {"name": "spender", "type": "address"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
        {"name": "witness", "type": "Witness"},
    ],
    "TokenPermissions": [
        {"name": "token", "type": "address"},
        {"name": "amount", "type": "uint256"},
    ],
    "Witness": [
        {"name": "to", "type": "address"},
        {"name": "facilitator", "type": "address"},
        {"name": "validAfter", "type": "uint256"},
    ],
}
