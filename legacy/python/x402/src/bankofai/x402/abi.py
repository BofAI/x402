"""
Shared ABI definitions for smart contracts
"""

import json
from typing import Any, List

# EIP-712 Primary Type for PaymentPermit
PAYMENT_PERMIT_PRIMARY_TYPE = "PaymentPermitDetails"

# EIP-712 Primary Type for GasFree
GASFREE_PRIMARY_TYPE = "PermitTransfer"

# EIP-712 Domain Type for PaymentPermit (Standard)
PAYMENT_PERMIT_EIP712_DOMAIN_TYPE = [
    {"name": "name", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

# ERC20 Token ABI
ERC20_ABI: List[dict[str, Any]] = [
    {
        "name": "balanceOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "account", "type": "address"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "allowance",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
        ],
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "name": "approve",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "spender", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "outputs": [{"name": "", "type": "bool"}],
    },
]

# PaymentPermit contract ABI
# Based on IPaymentPermit.sol interface from bankofai.x402-contracts
# Updated to match new contract structure (removed transferDetails parameter)
PAYMENT_PERMIT_ABI: List[dict[str, Any]] = [
    {
        "inputs": [
            {
                "name": "permit",
                "type": "tuple",
                "components": [
                    {
                        "name": "meta",
                        "type": "tuple",
                        "components": [
                            {"name": "kind", "type": "uint8"},
                            {"name": "paymentId", "type": "bytes16"},
                            {"name": "nonce", "type": "uint256"},
                            {"name": "validAfter", "type": "uint256"},
                            {"name": "validBefore", "type": "uint256"},
                        ],
                    },
                    {"name": "buyer", "type": "address"},
                    {"name": "caller", "type": "address"},
                    {
                        "name": "payment",
                        "type": "tuple",
                        "components": [
                            {"name": "payToken", "type": "address"},
                            {"name": "payAmount", "type": "uint256"},
                            {"name": "payTo", "type": "address"},
                        ],
                    },
                    {
                        "name": "fee",
                        "type": "tuple",
                        "components": [
                            {"name": "feeTo", "type": "address"},
                            {"name": "feeAmount", "type": "uint256"},
                        ],
                    },
                ],
            },
            {"name": "owner", "type": "address"},
            {"name": "signature", "type": "bytes"},
        ],
        "name": "permitTransferFrom",
        "stateMutability": "nonpayable",
        "type": "function",
        "outputs": [],
    },
    {
        "inputs": [],
        "name": "DOMAIN_SEPARATOR",
        "stateMutability": "view",
        "type": "function",
        "outputs": [{"name": "", "type": "bytes32"}],
    },
    {
        "inputs": [
            {"name": "", "type": "address"},
            {"name": "", "type": "uint256"},
        ],
        "name": "nonceBitmap",
        "stateMutability": "view",
        "type": "function",
        "outputs": [{"name": "", "type": "uint256"}],
    },
    {
        "inputs": [
            {"name": "owner", "type": "address"},
            {"name": "nonce", "type": "uint256"},
        ],
        "name": "nonceUsed",
        "stateMutability": "view",
        "type": "function",
        "outputs": [{"name": "", "type": "bool"}],
    },
]


def get_abi_json(abi: List[dict[str, Any]]) -> str:
    """Convert ABI list to JSON string"""
    return json.dumps(abi)


def get_payment_permit_eip712_types() -> dict[str, Any]:
    """Get EIP-712 type definitions for PaymentPermit

    Based on PermitHash.sol from the contract:
    - PERMIT_META_TYPEHASH =
      "PermitMeta(uint8 kind,bytes16 paymentId,uint256 nonce,uint256 validAfter,"
      "uint256 validBefore)"
    - PAYMENT_TYPEHASH = "Payment(address payToken,uint256 payAmount,address payTo)"
    - FEE_TYPEHASH = "Fee(address feeTo,uint256 feeAmount)"
    - PAYMENT_PERMIT_DETAILS_TYPEHASH =
      "PaymentPermitDetails(PermitMeta meta,address buyer,"
      "address caller,Payment payment,Fee fee)..."

    Note: The primary type name is "PaymentPermitDetails" to match the contract's typehash.
    """
    return {
        "PermitMeta": [
            {"name": "kind", "type": "uint8"},
            {"name": "paymentId", "type": "bytes16"},
            {"name": "nonce", "type": "uint256"},
            {"name": "validAfter", "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
        ],
        "Payment": [
            {"name": "payToken", "type": "address"},
            {"name": "payAmount", "type": "uint256"},
            {"name": "payTo", "type": "address"},
        ],
        "Fee": [
            {"name": "feeTo", "type": "address"},
            {"name": "feeAmount", "type": "uint256"},
        ],
        "PaymentPermitDetails": [
            {"name": "meta", "type": "PermitMeta"},
            {"name": "buyer", "type": "address"},
            {"name": "caller", "type": "address"},
            {"name": "payment", "type": "Payment"},
            {"name": "fee", "type": "Fee"},
        ],
    }


def calculate_method_id(abi: List[dict[str, Any]], method_name: str) -> str:
    """Calculate Method ID from ABI dynamically.

    Args:
        abi: Contract ABI definition list
        method_name: Function name

    Returns:
        Method ID (8 hex characters)

    Raises:
        ValueError: If function not found in ABI

    Example:
        >>> method_id = calculate_method_id(PAYMENT_PERMIT_ABI, "permitTransferFrom")
        >>> print(method_id)  # "c13f2d68"
    """
    from Crypto.Hash import keccak

    # Find function definition in ABI
    func_abi = None
    for item in abi:
        if item.get("type") == "function" and item.get("name") == method_name:
            func_abi = item
            break

    if not func_abi:
        raise ValueError(f"Function '{method_name}' not found in ABI")

    # Build function signature
    def get_type_string(param: dict[str, Any]) -> str:
        """Recursively build parameter type string"""
        param_type = param["type"]

        if param_type == "tuple":
            # For tuple, recursively build its components
            components = param.get("components", [])
            if not components:
                return "tuple"
            component_types = [get_type_string(c) for c in components]
            return f"({','.join(component_types)})"
        else:
            return param_type

    # Build complete function signature
    input_types = [get_type_string(inp) for inp in func_abi.get("inputs", [])]
    function_signature = f"{method_name}({','.join(input_types)})"

    # Calculate Method ID (first 4 bytes of Keccak256)
    k = keccak.new(digest_bits=256)
    k.update(function_signature.encode())
    method_id = k.hexdigest()[:8]

    return method_id


def get_function_signature(abi: List[dict[str, Any]], method_name: str) -> str:
    """Get complete function signature string.

    Args:
        abi: Contract ABI definition list
        method_name: Function name

    Returns:
        Function signature string, e.g.:
        "permitTransferFrom(((uint8,bytes16,uint256,uint256,uint256),...),(...),address,bytes)"

    Example:
        >>> sig = get_function_signature(PAYMENT_PERMIT_ABI, "permitTransferFrom")
        >>> print(sig)
    """

    func_abi = None
    for item in abi:
        if item.get("type") == "function" and item.get("name") == method_name:
            func_abi = item
            break

    if not func_abi:
        raise ValueError(f"Function '{method_name}' not found in ABI")

    def get_type_string(param: dict[str, Any]) -> str:
        param_type = param["type"]
        if param_type == "tuple":
            components = param.get("components", [])
            if not components:
                return "tuple"
            component_types = [get_type_string(c) for c in components]
            return f"({','.join(component_types)})"
        else:
            return param_type

    input_types = [get_type_string(inp) for inp in func_abi.get("inputs", [])]
    return f"{method_name}({','.join(input_types)})"


def get_all_method_ids(abi: List[dict[str, Any]]) -> dict[str, str]:
    """Get Method IDs for all functions in ABI.

    Args:
        abi: Contract ABI definition list

    Returns:
        Dict with function names as keys and Method IDs as values

    Example:
        >>> method_ids = get_all_method_ids(PAYMENT_PERMIT_ABI)
        >>> print(method_ids)
        {
            'permitTransferFrom': 'c13f2d68',
            'permitTransferFromWithCallback': '7216bdb4',
            'nonceBitmap': '4fe02b44',
            'nonceUsed': '1647795e'
        }
    """
    result = {}
    for item in abi:
        if item.get("type") == "function":
            method_name = item.get("name")
            if method_name:
                try:
                    result[method_name] = calculate_method_id(abi, method_name)
                except Exception:
                    pass
    return result
