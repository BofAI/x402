"""
Types, ABI, and EIP-712 definitions for exact mechanism.
"""

import json
import secrets
import time
from typing import Any, List

from pydantic import BaseModel, Field

SCHEME_EXACT = "exact"

# Default validity period (1 hour)
DEFAULT_VALIDITY_SECONDS = 3600


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


class TransferAuthorization(BaseModel):
    """TransferWithAuthorization parameters"""

    from_address: str = Field(alias="from")
    to: str
    value: str
    valid_after: str = Field(alias="validAfter")
    valid_before: str = Field(alias="validBefore")
    nonce: str  # 32-byte hex string (0x...)

    class Config:
        populate_by_name = True


# ---------------------------------------------------------------------------
# EIP-712 type definitions for TransferWithAuthorization
# ---------------------------------------------------------------------------

TRANSFER_AUTH_EIP712_DOMAIN_TYPE = [
    {"name": "name", "type": "string"},
    {"name": "version", "type": "string"},
    {"name": "chainId", "type": "uint256"},
    {"name": "verifyingContract", "type": "address"},
]

TRANSFER_AUTH_EIP712_TYPES = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ],
}

TRANSFER_AUTH_PRIMARY_TYPE = "TransferWithAuthorization"


# ---------------------------------------------------------------------------
# ABI for transferWithAuthorization (v, r, s variant)
# ---------------------------------------------------------------------------

TRANSFER_WITH_AUTHORIZATION_ABI: List[dict[str, Any]] = [
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
    },
]

AUTHORIZATION_STATE_ABI: List[dict[str, Any]] = [
    {
        "inputs": [
            {"name": "authorizer", "type": "address"},
            {"name": "nonce", "type": "bytes32"},
        ],
        "name": "authorizationState",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
]


def get_transfer_with_authorization_abi_json() -> str:
    return json.dumps(TRANSFER_WITH_AUTHORIZATION_ABI)


def build_eip712_message(
    auth: TransferAuthorization,
) -> dict[str, Any]:
    """Build EIP-712 message dict from authorization."""
    return {
        "from": auth.from_address,
        "to": auth.to,
        "value": int(auth.value),
        "validAfter": int(auth.valid_after),
        "validBefore": int(auth.valid_before),
        "nonce": bytes.fromhex(auth.nonce[2:] if auth.nonce.startswith("0x") else auth.nonce),
    }


def build_eip712_domain(
    token_name: str,
    token_version: str,
    chain_id: int,
    verifying_contract: str,
) -> dict[str, Any]:
    """Build EIP-712 domain dict for exact."""
    return {
        "name": token_name,
        "version": token_version,
        "chainId": chain_id,
        "verifyingContract": verifying_contract,
    }


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------


def create_nonce() -> str:
    """Generate a random 32-byte nonce (0x-prefixed hex)."""
    return "0x" + secrets.token_hex(32)


def create_validity_window(
    duration: int = DEFAULT_VALIDITY_SECONDS,
) -> tuple[int, int]:
    """Create (validAfter, validBefore) timestamps.

    Adds a 30-second buffer before *now* to account for clock skew.
    """
    now = int(time.time())
    return now - 30, now + duration
