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
# Permit2 verify errors
ERR_PERMIT2_INVALID_SPENDER = "invalid_permit2_spender"
ERR_PERMIT2_RECIPIENT_MISMATCH = "invalid_permit2_recipient_mismatch"
ERR_PERMIT2_INVALID_FACILITATOR = "invalid_permit2_facilitator_mismatch"
ERR_PERMIT2_DEADLINE_EXPIRED = "permit2_deadline_expired"
ERR_PERMIT2_NOT_YET_VALID = "permit2_not_yet_valid"
ERR_PERMIT2_AMOUNT_MISMATCH = "permit2_amount_mismatch"
ERR_PERMIT2_TOKEN_MISMATCH = "permit2_token_mismatch"
ERR_PERMIT2_INVALID_SIGNATURE = "invalid_permit2_signature"
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
# ERC-20 approval extension verify errors
ERR_ERC20_APPROVAL_EXTENSION_FORMAT = "invalid_erc20_approval_extension_format"
ERR_ERC20_APPROVAL_FROM_MISMATCH = "erc20_approval_from_mismatch"
ERR_ERC20_APPROVAL_ASSET_MISMATCH = "erc20_approval_asset_mismatch"
ERR_ERC20_APPROVAL_SPENDER_NOT_PERMIT2 = "erc20_approval_spender_not_permit2"
ERR_ERC20_APPROVAL_TX_WRONG_TARGET = "erc20_approval_tx_wrong_target"
ERR_ERC20_APPROVAL_TX_WRONG_SELECTOR = "erc20_approval_tx_wrong_selector"
ERR_ERC20_APPROVAL_TX_WRONG_SPENDER = "erc20_approval_tx_wrong_spender"
ERR_ERC20_APPROVAL_TX_INVALID_CALLDATA = "erc20_approval_tx_invalid_calldata"
ERR_ERC20_APPROVAL_TX_SIGNER_MISMATCH = "erc20_approval_tx_signer_mismatch"
ERR_ERC20_APPROVAL_TX_INVALID_SIGNATURE = "erc20_approval_tx_invalid_signature"
ERR_ERC20_APPROVAL_TX_PARSE_FAILED = "erc20_approval_tx_parse_failed"
ERR_ERC20_APPROVAL_TX_FAILED = "erc20_approval_tx_failed"


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
    default_rpc_url: str


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
        "default_rpc_url": "https://sepolia.base.org",
        "default_asset": {
            "address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "name": "USDC",
            "version": "2",
            "decimals": 6,
        },
    },
    # BSC Testnet
    "eip155:97": {
        "chain_id": 97,
        "default_rpc_url": "https://bsc-testnet-rpc.publicnode.com",
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

BALANCE_OF_ABI = [
    {
        "inputs": [{"name": "account", "type": "address"}],
        "name": "balanceOf",
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

EIP2612_PERMIT_TYPES: dict[str, list[dict[str, str]]] = {
    "Permit": [
        {"name": "owner", "type": "address"},
        {"name": "spender", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
    ]
}

EIP2612_NONCES_ABI = [
    {
        "type": "function",
        "name": "nonces",
        "inputs": [{"name": "owner", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    }
]

ERC20_APPROVE_GAS_LIMIT = 70_000
DEFAULT_MAX_FEE_PER_GAS = 1_000_000_000
DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 100_000_000

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

# Permit2 EIP-712 types for signing PermitWitnessTransferFrom.
# Types must be in alphabetical order after the primary type.
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

# Canonical Permit2 address and overrides.
PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
PERMIT2_ADDRESSES: dict[str, str] = {
    "eip155:56": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
    "eip155:97": "0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768",
}

# x402 exact Permit2 proxy addresses.
X402_EXACT_PERMIT2_PROXY_ADDRESS = "0xEe38Ec718255fe78e9D16aCC0e1183C731679b23"
X402_EXACT_PERMIT2_PROXY_ADDRESSES: dict[str, str] = {
    "eip155:56": X402_EXACT_PERMIT2_PROXY_ADDRESS,
    "eip155:97": X402_EXACT_PERMIT2_PROXY_ADDRESS,
}


def get_permit2_address(network: str) -> str:
    """Resolve Permit2 contract address for a network."""
    return PERMIT2_ADDRESSES.get(network, PERMIT2_ADDRESS)


def get_x402_exact_permit2_proxy_address(network: str) -> str:
    """Resolve x402 exact Permit2 proxy address for a network."""
    return X402_EXACT_PERMIT2_PROXY_ADDRESSES.get(network, X402_EXACT_PERMIT2_PROXY_ADDRESS)


_PERMIT2_WITNESS_ABI_COMPONENTS = [
    {"name": "to", "type": "address", "internalType": "address"},
    {"name": "facilitator", "type": "address", "internalType": "address"},
    {"name": "validAfter", "type": "uint256", "internalType": "uint256"},
]

# x402ExactPermit2Proxy ABI (settle + settleWithPermit).
x402ExactPermit2ProxyABI = [
    {
        "type": "function",
        "name": "settle",
        "inputs": [
            {
                "name": "permit",
                "type": "tuple",
                "internalType": "struct ISignatureTransfer.PermitTransferFrom",
                "components": [
                    {
                        "name": "permitted",
                        "type": "tuple",
                        "internalType": "struct ISignatureTransfer.TokenPermissions",
                        "components": [
                            {"name": "token", "type": "address", "internalType": "address"},
                            {"name": "amount", "type": "uint256", "internalType": "uint256"},
                        ],
                    },
                    {"name": "nonce", "type": "uint256", "internalType": "uint256"},
                    {"name": "deadline", "type": "uint256", "internalType": "uint256"},
                ],
            },
            {"name": "owner", "type": "address", "internalType": "address"},
            {
                "name": "witness",
                "type": "tuple",
                "internalType": "struct x402ExactPermit2Proxy.Witness",
                "components": _PERMIT2_WITNESS_ABI_COMPONENTS,
            },
            {"name": "signature", "type": "bytes", "internalType": "bytes"},
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
                "internalType": "struct x402ExactPermit2Proxy.EIP2612Permit",
                "components": [
                    {"name": "value", "type": "uint256", "internalType": "uint256"},
                    {"name": "deadline", "type": "uint256", "internalType": "uint256"},
                    {"name": "r", "type": "bytes32", "internalType": "bytes32"},
                    {"name": "s", "type": "bytes32", "internalType": "bytes32"},
                    {"name": "v", "type": "uint8", "internalType": "uint8"},
                ],
            },
            {
                "name": "permit",
                "type": "tuple",
                "internalType": "struct ISignatureTransfer.PermitTransferFrom",
                "components": [
                    {
                        "name": "permitted",
                        "type": "tuple",
                        "internalType": "struct ISignatureTransfer.TokenPermissions",
                        "components": [
                            {"name": "token", "type": "address", "internalType": "address"},
                            {"name": "amount", "type": "uint256", "internalType": "uint256"},
                        ],
                    },
                    {"name": "nonce", "type": "uint256", "internalType": "uint256"},
                    {"name": "deadline", "type": "uint256", "internalType": "uint256"},
                ],
            },
            {"name": "owner", "type": "address", "internalType": "address"},
            {
                "name": "witness",
                "type": "tuple",
                "internalType": "struct x402ExactPermit2Proxy.Witness",
                "components": _PERMIT2_WITNESS_ABI_COMPONENTS,
            },
            {"name": "signature", "type": "bytes", "internalType": "bytes"},
        ],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
]
