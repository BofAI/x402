"""TRON constants for the exact payment scheme."""

# TRON chain IDs for TIP-712 signing
TRON_CHAIN_IDS: dict[str, int] = {
    "tron:mainnet": 728126428,   # 0x2b6653dc
    "tron:shasta": 2494104990,   # 0x94a9059e
    "tron:nile": 3448148188,     # 0xcd8690dc
}

# Default stablecoins per network (USDT)
TRON_DEFAULT_ASSETS: dict[str, dict] = {
    "tron:mainnet": {
        "address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "name": "Tether USD",
        "version": "1",
        "decimals": 6,
    },
    "tron:nile": {
        "address": "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",
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
AUTHORIZATION_TYPES = {
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
