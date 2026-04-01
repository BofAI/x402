"""TRON-specific payload and data types."""

from dataclasses import dataclass
from typing import Any


@dataclass
class ExactEIP3009Authorization:
    """TIP-712 TransferWithAuthorization data."""

    from_address: str
    to: str
    value: str
    valid_after: str
    valid_before: str
    nonce: str


@dataclass
class ExactEIP3009Payload:
    """Exact payment payload for TRON networks."""

    authorization: ExactEIP3009Authorization
    signature: str | None = None

    def to_dict(self) -> dict[str, Any]:
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


@dataclass
class Permit2Witness:
    to: str
    facilitator: str
    valid_after: str


@dataclass
class Permit2Authorization:
    from_address: str
    permitted_token: str
    permitted_amount: str
    spender: str
    nonce: str
    deadline: str
    witness: Permit2Witness


@dataclass
class ExactPermit2Payload:
    permit2_authorization: Permit2Authorization
    signature: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "signature": self.signature,
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
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ExactPermit2Payload":
        auth = data.get("permit2Authorization", {})
        permitted = auth.get("permitted", {})
        witness = auth.get("witness", {})
        return cls(
            permit2_authorization=Permit2Authorization(
                from_address=auth.get("from", ""),
                permitted_token=permitted.get("token", ""),
                permitted_amount=permitted.get("amount", ""),
                spender=auth.get("spender", ""),
                nonce=auth.get("nonce", ""),
                deadline=auth.get("deadline", ""),
                witness=Permit2Witness(
                    to=witness.get("to", ""),
                    facilitator=witness.get("facilitator", ""),
                    valid_after=witness.get("validAfter", ""),
                ),
            ),
            signature=data.get("signature", ""),
        )


ExactTronPayloadV1 = ExactEIP3009Payload
ExactTronPayloadV2 = ExactEIP3009Payload | ExactPermit2Payload


def is_permit2_payload(data: dict[str, Any]) -> bool:
    return "permit2Authorization" in data


@dataclass
class TypedDataDomain:
    """TIP-712 domain separator."""

    name: str
    version: str | None
    chain_id: int
    verifying_contract: str  # Always 0x-prefixed hex (normalized for signing)


@dataclass
class TypedDataField:
    """Field definition for TIP-712 types."""

    name: str
    type: str
