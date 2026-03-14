"""EVM-specific payload and data types."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ExactEIP3009Authorization:
    """EIP-3009 TransferWithAuthorization data."""

    from_address: str  # 'from' is reserved in Python
    to: str
    value: str  # Amount in smallest unit as string
    valid_after: str  # Unix timestamp as string
    valid_before: str  # Unix timestamp as string
    nonce: str  # 32-byte nonce as hex string (0x...)


@dataclass
class ExactEIP3009Payload:
    """Exact payment payload for EVM networks."""

    authorization: ExactEIP3009Authorization
    signature: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization.

        Returns:
            Dict with authorization and signature fields.
        """
        result: dict[str, Any] = {
            "authorization": {
                "from": self.authorization.from_address,
                "to": self.authorization.to,
                "value": self.authorization.value,
                "validAfter": self.authorization.valid_after,
                "validBefore": self.authorization.valid_before,
                "nonce": self.authorization.nonce,
            }
        }
        if self.signature:
            result["signature"] = self.signature
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExactEIP3009Payload":
        """Create from dictionary.

        Args:
            data: Dict with authorization and optional signature.

        Returns:
            ExactEIP3009Payload instance.
        """
        auth = data.get("authorization", {})
        return cls(
            authorization=ExactEIP3009Authorization(
                from_address=auth.get("from", ""),
                to=auth.get("to", ""),
                value=auth.get("value", ""),
                valid_after=auth.get("validAfter", ""),
                valid_before=auth.get("validBefore", ""),
                nonce=auth.get("nonce", ""),
            ),
            signature=data.get("signature"),
        )


# Type aliases for V1/V2 compatibility
@dataclass
class Permit2Witness:
    """Permit2 witness struct for exact proxy settlement."""

    to: str
    facilitator: str
    valid_after: str


@dataclass
class ExactPermit2Authorization:
    """Permit2 authorization data."""

    from_address: str
    permitted_token: str
    permitted_amount: str
    spender: str
    nonce: str
    deadline: str
    witness: Permit2Witness


@dataclass
class ExactPermit2Payload:
    """Permit2 payload for exact EVM payments."""

    permit2_authorization: ExactPermit2Authorization
    signature: str

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "permit2Authorization": {
                "from": self.permit2_authorization.from_address,
                "permitted": {
                    "token": self.permit2_authorization.permitted_token,
                    "amount": self.permit2_authorization.permitted_amount,
                },
                "spender": self.permit2_authorization.spender,
                "nonce": self.permit2_authorization.nonce,
                "deadline": self.permit2_authorization.deadline,
                "witness": {
                    "to": self.permit2_authorization.witness.to,
                    "facilitator": self.permit2_authorization.witness.facilitator,
                    "validAfter": self.permit2_authorization.witness.valid_after,
                },
            },
            "signature": self.signature,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExactPermit2Payload":
        """Create from dictionary."""
        auth = data.get("permit2Authorization", {})
        permitted = auth.get("permitted", {})
        witness = auth.get("witness", {})
        return cls(
            permit2_authorization=ExactPermit2Authorization(
                from_address=auth.get("from", ""),
                permitted_token=permitted.get("token", ""),
                permitted_amount=permitted.get("amount", ""),
                spender=auth.get("spender", ""),
                nonce=str(auth.get("nonce", "")),
                deadline=str(auth.get("deadline", "")),
                witness=Permit2Witness(
                    to=witness.get("to", ""),
                    facilitator=witness.get("facilitator", ""),
                    valid_after=str(witness.get("validAfter", "")),
                ),
            ),
            signature=data.get("signature", ""),
        )


ExactEvmPayloadV1 = ExactEIP3009Payload
ExactEvmPayloadV2 = ExactEIP3009Payload | ExactPermit2Payload


@dataclass
class TypedDataDomain:
    """EIP-712 domain separator."""

    name: str
    version: str
    chain_id: int
    verifying_contract: str


@dataclass
class TypedDataField:
    """Field definition for EIP-712 types."""

    name: str
    type: str


@dataclass
class TransactionReceipt:
    """Transaction receipt from blockchain."""

    status: int
    block_number: int
    tx_hash: str


@dataclass
class ERC6492SignatureData:
    """Parsed ERC-6492 signature components."""

    factory: bytes  # 20-byte factory address (zero if not ERC-6492)
    factory_calldata: bytes  # Deployment calldata (empty if not ERC-6492)
    inner_signature: bytes  # The actual signature (EIP-1271 or EOA)


# EIP-712 authorization types for signing
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

# EIP-712 domain types
DOMAIN_TYPES: dict[str, list[dict[str, str]]] = {
    "EIP712Domain": [
        {"name": "name", "type": "string"},
        {"name": "version", "type": "string"},
        {"name": "chainId", "type": "uint256"},
        {"name": "verifyingContract", "type": "address"},
    ]
}
