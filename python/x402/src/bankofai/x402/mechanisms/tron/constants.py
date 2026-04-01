"""TRON mechanism constants - network configs, ABIs, error codes."""

from typing import Any, TypedDict

# Scheme identifier
SCHEME_EXACT = "exact"

# Default validity period (1 hour in seconds)
DEFAULT_VALIDITY_PERIOD = 3600

# Default validity buffer (10 minutes before now for clock skew)
DEFAULT_VALIDITY_BUFFER = 600

# TRON chain IDs for TIP-712 signing
TRON_CHAIN_IDS: dict[str, int] = {
    "tron:mainnet": 728126428,  # 0x2b6653dc
    "tron:shasta": 2494104990,  # 0x94a9059e
    "tron:nile": 3448148188,  # 0xcd8690dc
}


class _AssetInfoRequired(TypedDict):
    address: str
    name: str
    version: str
    decimals: int


class AssetInfo(_AssetInfoRequired, total=False):
    asset_transfer_method: str
    supports_eip2612: bool


class _NetworkConfigRequired(TypedDict):
    chain_id: int


class NetworkConfig(_NetworkConfigRequired, total=False):
    default_asset: AssetInfo
    assets: list[AssetInfo]


TRON_NETWORK_CONFIGS: dict[str, NetworkConfig] = {
    "tron:mainnet": {
        "chain_id": TRON_CHAIN_IDS["tron:mainnet"],
        "default_asset": {
            "address": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            "name": "Tether USD",
            "version": "1",
            "decimals": 6,
            "asset_transfer_method": "permit2",
        },
        "assets": [
            {
                "address": "TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
                "name": "Usdd Stablecoin",
                "version": "1",
                "decimals": 18,
                "asset_transfer_method": "permit2",
            },
        ],
    },
    "tron:nile": {
        "chain_id": TRON_CHAIN_IDS["tron:nile"],
        "default_asset": {
            "address": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
            "name": "Tether USD",
            "version": "1",
            "decimals": 6,
            "asset_transfer_method": "permit2",
        },
        "assets": [
            {
                "address": "TZ78R2E6ejfFhxq8hxrmuqT6hGBxjHQbo4",
                "name": "Usdd Stablecoin",
                "version": "1",
                "decimals": 18,
                "asset_transfer_method": "permit2",
            },
        ],
    },
    "tron:shasta": {
        "chain_id": TRON_CHAIN_IDS["tron:shasta"],
        "default_asset": {
            "address": "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
            "name": "Tether USD",
            "version": "1",
            "decimals": 6,
            "asset_transfer_method": "permit2",
        },
    },
}

# Default fee limit used for TRON contract calls (1,000 TRX).
DEFAULT_FEE_LIMIT_SUN = 1_000_000_000

# Backwards-compatible alias for defaults
TRON_DEFAULT_ASSETS: dict[str, dict[str, Any]] = {
    network: config["default_asset"]  # type: ignore[index]
    for network, config in TRON_NETWORK_CONFIGS.items()
    if config.get("default_asset")
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

# Permit2 settle errors
ERR_PERMIT2_INVALID_AMOUNT = "permit2_invalid_amount"
ERR_PERMIT2_INVALID_DESTINATION = "permit2_invalid_destination"
ERR_PERMIT2_INVALID_OWNER = "permit2_invalid_owner"
ERR_PERMIT2_PAYMENT_TOO_EARLY = "permit2_payment_too_early"
ERR_PERMIT2_INVALID_NONCE = "permit2_invalid_nonce"
ERR_PERMIT2_2612_AMOUNT_MISMATCH = "permit2_2612_amount_mismatch"

# EIP-2612 extension verify errors
ERR_EIP2612_EXTENSION_FORMAT = "invalid_eip2612_extension_format"
ERR_EIP2612_FROM_MISMATCH = "eip2612_from_mismatch"
ERR_EIP2612_ASSET_MISMATCH = "eip2612_asset_mismatch"
ERR_EIP2612_SPENDER_NOT_PERMIT2 = "eip2612_spender_not_permit2"
ERR_EIP2612_DEADLINE_EXPIRED = "eip2612_deadline_expired"

# TRC-20 approval gas sponsoring errors
ERR_TRC20_APPROVAL_FORMAT = "invalid_trc20_approval_format"
ERR_TRC20_APPROVAL_FROM_MISMATCH = "invalid_trc20_approval_from_mismatch"
ERR_TRC20_APPROVAL_ASSET_MISMATCH = "invalid_trc20_approval_asset_mismatch"
ERR_TRC20_APPROVAL_SPENDER_NOT_PERMIT2 = "invalid_trc20_approval_spender_not_permit2"
ERR_TRC20_APPROVAL_TX_MISSING_DATA = "invalid_trc20_approval_tx_missing_data"
ERR_TRC20_APPROVAL_TX_WRONG_TARGET = "invalid_trc20_approval_tx_wrong_target"
ERR_TRC20_APPROVAL_TX_WRONG_SELECTOR = "invalid_trc20_approval_tx_wrong_selector"
ERR_TRC20_APPROVAL_TX_WRONG_SPENDER = "invalid_trc20_approval_tx_wrong_spender"
ERR_TRC20_APPROVAL_TX_WRONG_AMOUNT = "invalid_trc20_approval_tx_wrong_amount"
ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE = "invalid_trc20_approval_tx_invalid_signature"

# Shared Permit2 witness ABI components.
_PERMIT2_WITNESS_ABI_COMPONENTS = [
    {"name": "to", "type": "address"},
    {"name": "facilitator", "type": "address"},
    {"name": "validAfter", "type": "uint256"},
]

# x402ExactPermit2Proxy ABI - settle + settleWithPermit functions.
x402ExactPermit2ProxyABI = [
    {
        "type": "function",
        "name": "settle",
        "inputs": [
            {
                "name": "permit",
                "type": "tuple",
                "components": [
                    {
                        "name": "permitted",
                        "type": "tuple",
                        "components": [
                            {"name": "token", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                    },
                    {"name": "nonce", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                ],
            },
            {"name": "owner", "type": "address"},
            {
                "name": "witness",
                "type": "tuple",
                "components": _PERMIT2_WITNESS_ABI_COMPONENTS,
            },
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    {
        "type": "function",
        "name": "settleWithPermit",
        "inputs": [
            {
                "name": "permit2612",
                "type": "tuple",
                "components": [
                    {"name": "value", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                    {"name": "r", "type": "bytes32"},
                    {"name": "s", "type": "bytes32"},
                    {"name": "v", "type": "uint8"},
                ],
            },
            {
                "name": "permit",
                "type": "tuple",
                "components": [
                    {
                        "name": "permitted",
                        "type": "tuple",
                        "components": [
                            {"name": "token", "type": "address"},
                            {"name": "amount", "type": "uint256"},
                        ],
                    },
                    {"name": "nonce", "type": "uint256"},
                    {"name": "deadline", "type": "uint256"},
                ],
            },
            {"name": "owner", "type": "address"},
            {
                "name": "witness",
                "type": "tuple",
                "components": _PERMIT2_WITNESS_ABI_COMPONENTS,
            },
            {"name": "signature", "type": "bytes"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
]

# TIP-712 type definitions for EIP-2612 Permit
EIP2612_PERMIT_TYPES: dict[str, list[dict[str, str]]] = {
    "Permit": [
        {"name": "owner", "type": "address"},
        {"name": "spender", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
    ]
}

# EIP-2612 nonces ABI (view) for reading permit nonces.
EIP2612_NONCES_ABI = [
    {
        "type": "function",
        "name": "nonces",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    }
]

# TRC-20 allowance ABI (view) for Permit2 approvals.
TRC20_ALLOWANCE_ABI = [
    {
        "type": "function",
        "name": "allowance",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "outputs": [{"name": "allowance", "type": "uint256"}],
    }
]
