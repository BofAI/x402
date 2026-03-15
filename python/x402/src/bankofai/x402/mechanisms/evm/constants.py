"""EVM mechanism constants - network configs, ABIs, error codes."""

from typing import TypedDict

# Scheme identifier
SCHEME_EXACT = "exact"

# Default token decimals for USDC
DEFAULT_DECIMALS = 6

# EIP-3009 function names
FUNCTION_TRANSFER_WITH_AUTHORIZATION = "transferWithAuthorization"
FUNCTION_AUTHORIZATION_STATE = "authorizationState"

# Transaction status
TX_STATUS_SUCCESS = 1
TX_STATUS_FAILED = 0

# Default validity period (1 hour in seconds)
DEFAULT_VALIDITY_PERIOD = 3600

# Default validity buffer (10 minutes before now for clock skew)
DEFAULT_VALIDITY_BUFFER = 600

# ERC-6492 magic value (32 bytes)
# bytes32(uint256(keccak256("erc6492.invalid.signature")) - 1)
ERC6492_MAGIC_VALUE = bytes.fromhex(
    "6492649264926492649264926492649264926492649264926492649264926492"
)

# EIP-1271 magic value (returned by isValidSignature on success)
EIP1271_MAGIC_VALUE = bytes.fromhex("1626ba7e")

# Error codes
ERR_INVALID_SIGNATURE = "invalid_exact_evm_payload_signature"
ERR_UNDEPLOYED_SMART_WALLET = "invalid_exact_evm_payload_undeployed_smart_wallet"
ERR_SMART_WALLET_DEPLOYMENT_FAILED = "smart_wallet_deployment_failed"
ERR_RECIPIENT_MISMATCH = "invalid_exact_evm_payload_recipient_mismatch"
ERR_INSUFFICIENT_AMOUNT = "invalid_exact_evm_payload_authorization_value"
ERR_VALID_BEFORE_EXPIRED = "invalid_exact_evm_payload_authorization_valid_before"
ERR_VALID_AFTER_FUTURE = "invalid_exact_evm_payload_authorization_valid_after"
ERR_NONCE_ALREADY_USED = "nonce_already_used"
ERR_INSUFFICIENT_BALANCE = "insufficient_balance"
ERR_MISSING_EIP712_DOMAIN = "missing_eip712_domain"
ERR_NETWORK_MISMATCH = "network_mismatch"
ERR_UNSUPPORTED_SCHEME = "unsupported_scheme"
ERR_FAILED_TO_GET_NETWORK_CONFIG = "invalid_exact_evm_failed_to_get_network_config"
ERR_FAILED_TO_GET_ASSET_INFO = "invalid_exact_evm_failed_to_get_asset_info"
ERR_FAILED_TO_VERIFY_SIGNATURE = "invalid_exact_evm_failed_to_verify_signature"
ERR_TRANSACTION_FAILED = "transaction_failed"
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


class _AssetInfoRequired(TypedDict):
    """Required fields for a token asset."""

    address: str
    name: str
    version: str
    decimals: int


class AssetInfo(_AssetInfoRequired, total=False):
    """Information about a token asset."""

    asset_transfer_method: str
    supports_eip2612: bool


class _NetworkConfigRequired(TypedDict):
    """Required fields for an EVM network configuration."""

    chain_id: int


class NetworkConfig(_NetworkConfigRequired, total=False):
    """Configuration for an EVM network."""

    default_asset: AssetInfo


# Network configurations
NETWORK_CONFIGS: dict[str, NetworkConfig] = {
    # Base Mainnet
    "eip155:8453": {
        "chain_id": 8453,
        "default_asset": {
            "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "name": "USD Coin",
            "version": "2",
            "decimals": 6,
        },
    },
    # Base Sepolia (Testnet)
    "eip155:84532": {
        "chain_id": 84532,
        "default_asset": {
            "address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "name": "USDC",
            "version": "2",
            "decimals": 6,
        },
    },
    # MegaETH Mainnet (uses Permit2 instead of EIP-3009, supports EIP-2612)
    "eip155:4326": {
        "chain_id": 4326,
        "default_asset": {
            "address": "0xFAfDdbb3FC7688494971a79cc65DCa3EF82079E7",
            "name": "MegaUSD",
            "version": "1",
            "decimals": 18,
            "asset_transfer_method": "permit2",
            "supports_eip2612": True,
        },
    },
    # Monad Mainnet
    "eip155:143": {
        "chain_id": 143,
        "default_asset": {
            "address": "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
            "name": "USD Coin",
            "version": "2",
            "decimals": 6,
        },
    },
    # BSC Mainnet
    "eip155:56": {
        "chain_id": 56,
        "default_asset": {
            "address": "0x55d398326f99059fF775485246999027B3197955",
            "name": "Tether USD",
            "version": "1",
            "decimals": 18,
            "asset_transfer_method": "permit2",
        },
    },
    # BSC Testnet
    "eip155:97": {
        "chain_id": 97,
        "default_asset": {
            "address": "0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
            "name": "Tether USD",
            "version": "1",
            "decimals": 18,
            "asset_transfer_method": "permit2",
        },
    },
}

PERMIT2_ADDRESSES: dict[str, str] = {
    "eip155:1": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    "eip155:56": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
    "eip155:97": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
}

X402_PERMIT2_PROXY_ADDRESSES: dict[str, str] = {
    "eip155:56": "0xEe38Ec718255fe78e9D16aCC0e1183C731679b23",
    "eip155:97": "0xEe38Ec718255fe78e9D16aCC0e1183C731679b23",
}

X402_UPTO_PERMIT2_PROXY_ADDRESSES: dict[str, str] = {
    "eip155:56": "0x2b30Ed9F37c7C21ae8779c5753B1cCf264DfD63C",
    "eip155:97": "0x2b30Ed9F37c7C21ae8779c5753B1cCf264DfD63C",
}

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

# V1 legacy constants are in x402.mechanisms.evm.v1.constants
# (V1_NETWORKS, V1_NETWORK_CHAIN_IDS, V1_DEFAULT_ASSETS)

# EIP-3009 ABIs
TRANSFER_WITH_AUTHORIZATION_VRS_ABI = [
    {
        "inputs": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"},
            {"name": "v", "type": "uint8"},
            {"name": "r", "type": "bytes32"},
            {"name": "s", "type": "bytes32"},
        ],
        "name": "transferWithAuthorization",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

TRANSFER_WITH_AUTHORIZATION_BYTES_ABI = [
    {
        "inputs": [
            {"name": "from", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce", "type": "bytes32"},
            {"name": "signature", "type": "bytes"},
        ],
        "name": "transferWithAuthorization",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

AUTHORIZATION_STATE_ABI = [
    {
        "inputs": [
            {"name": "authorizer", "type": "address"},
            {"name": "nonce", "type": "bytes32"},
        ],
        "name": "authorizationState",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    }
]

ERC20_ALLOWANCE_ABI = [
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "name": "allowance",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]

ERC20_APPROVE_ABI = [
    {
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "approve",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

X402_EXACT_PERMIT2_PROXY_ABI = [
    {
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
                "components": [
                    {"name": "to", "type": "address"},
                    {"name": "facilitator", "type": "address"},
                    {"name": "validAfter", "type": "uint256"},
                ],
            },
            {"name": "signature", "type": "bytes"},
        ],
        "name": "settle",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]

BALANCE_OF_ABI = [
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "view",
        "type": "function",
    }
]

IS_VALID_SIGNATURE_ABI = [
    {
        "inputs": [
            {"name": "hash", "type": "bytes32"},
            {"name": "signature", "type": "bytes"},
        ],
        "name": "isValidSignature",
        "outputs": [{"name": "magicValue", "type": "bytes4"}],
        "stateMutability": "view",
        "type": "function",
    }
]
