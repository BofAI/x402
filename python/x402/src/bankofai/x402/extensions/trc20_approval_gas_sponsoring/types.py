"""Type definitions for the TRC-20 Approval Gas Sponsoring Extension."""

import json

from dataclasses import dataclass
from typing import Any, Protocol

from ...interfaces import FacilitatorExtension


class Trc20ApprovalGasSponsoringSigner(Protocol):
    def get_addresses(self) -> list[str]:
        ...

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
    ) -> Any:
        ...

    def wait_for_transaction_receipt(self, tx_hash: str):
        ...

    def send_raw_transaction(self, signed_transaction: dict[str, Any]) -> str:
        ...

    def get_sign_weight(self, transaction: Any) -> Any:
        ...


TRC20_APPROVAL_GAS_SPONSORING = FacilitatorExtension(key="trc20ApprovalGasSponsoring")
TRC20_APPROVAL_GAS_SPONSORING_VERSION = "1"


@dataclass(frozen=True)
class Trc20ApprovalGasSponsoringExtension(FacilitatorExtension):
    signer: Trc20ApprovalGasSponsoringSigner | None = None


def create_trc20_approval_gas_sponsoring_extension(
    signer: Trc20ApprovalGasSponsoringSigner,
) -> Trc20ApprovalGasSponsoringExtension:
    return Trc20ApprovalGasSponsoringExtension(
        key=TRC20_APPROVAL_GAS_SPONSORING.key,
        signer=signer,
    )


@dataclass
class Trc20ApprovalGasSponsoringInfo:
    from_address: str
    asset: str
    spender: str
    amount: str
    signed_transaction: dict[str, Any]
    version: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Trc20ApprovalGasSponsoringInfo":
        signed_tx = data.get("signedTransaction")
        if isinstance(signed_tx, str):
            try:
                signed_tx = json.loads(signed_tx)
            except Exception:
                signed_tx = {}
        if not isinstance(signed_tx, dict):
            signed_tx = {}
        return cls(
            from_address=str(data.get("from", "")),
            asset=str(data.get("asset", "")),
            spender=str(data.get("spender", "")),
            amount=str(data.get("amount", "")),
            signed_transaction=signed_tx,
            version=str(data.get("version", "")),
        )


@dataclass
class Trc20ApprovalGasSponsoringServerInfo:
    description: str
    version: str


@dataclass
class Trc20ApprovalGasSponsoringExtensionInfo:
    info: Trc20ApprovalGasSponsoringInfo | Trc20ApprovalGasSponsoringServerInfo
    schema: dict[str, Any]
