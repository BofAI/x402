"""Type definitions for the EIP-2612 Gas Sponsoring Extension."""

from dataclasses import dataclass
from typing import Any

from ...interfaces import FacilitatorExtension

EIP2612_GAS_SPONSORING = FacilitatorExtension(key="eip2612GasSponsoring")


@dataclass
class Eip2612GasSponsoringInfo:
    from_address: str
    asset: str
    spender: str
    amount: str
    nonce: str
    deadline: str
    signature: str
    version: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Eip2612GasSponsoringInfo":
        return cls(
            from_address=str(data.get("from", "")),
            asset=str(data.get("asset", "")),
            spender=str(data.get("spender", "")),
            amount=str(data.get("amount", "")),
            nonce=str(data.get("nonce", "")),
            deadline=str(data.get("deadline", "")),
            signature=str(data.get("signature", "")),
            version=str(data.get("version", "")),
        )


@dataclass
class Eip2612GasSponsoringServerInfo:
    description: str
    version: str


@dataclass
class Eip2612GasSponsoringExtension:
    info: Eip2612GasSponsoringInfo | Eip2612GasSponsoringServerInfo
    schema: dict[str, Any]
