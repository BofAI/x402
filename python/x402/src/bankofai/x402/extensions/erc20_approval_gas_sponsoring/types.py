"""Type definitions for the ERC-20 Approval Gas Sponsoring Extension."""

from dataclasses import dataclass
from typing import Any, Protocol

from ...interfaces import FacilitatorExtension


class Erc20ApprovalGasSponsoringSigner(Protocol):
    def get_addresses(self) -> list[str]: ...

    def read_contract(
        self, address: str, abi: list[dict[str, Any]], function_name: str, *args: Any
    ) -> Any: ...

    def verify_typed_data(
        self,
        address: str,
        domain: dict[str, Any],
        types: dict[str, Any],
        primary_type: str,
        message: dict[str, Any],
        signature: bytes | str,
    ) -> bool: ...

    def write_contract(
        self, address: str, abi: list[dict[str, Any]], function_name: str, *args: Any
    ) -> str: ...

    def send_transaction(self, to: str, data: bytes) -> str: ...

    def wait_for_transaction_receipt(self, tx_hash: str): ...

    def get_code(self, address: str) -> bytes: ...

    def send_raw_transaction(self, serialized_tx: str) -> str: ...


ERC20_APPROVAL_GAS_SPONSORING = FacilitatorExtension(key="erc20ApprovalGasSponsoring")
ERC20_APPROVAL_GAS_SPONSORING_VERSION = "1"


@dataclass(frozen=True)
class Erc20ApprovalGasSponsoringExtension(FacilitatorExtension):
    signer: Erc20ApprovalGasSponsoringSigner | None = None


def create_erc20_approval_gas_sponsoring_extension(
    signer: Erc20ApprovalGasSponsoringSigner,
) -> Erc20ApprovalGasSponsoringExtension:
    return Erc20ApprovalGasSponsoringExtension(
        key=ERC20_APPROVAL_GAS_SPONSORING.key,
        signer=signer,
    )


@dataclass
class Erc20ApprovalGasSponsoringInfo:
    from_address: str
    asset: str
    spender: str
    amount: str
    signed_transaction: str
    version: str

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Erc20ApprovalGasSponsoringInfo":
        return cls(
            from_address=str(data.get("from", "")),
            asset=str(data.get("asset", "")),
            spender=str(data.get("spender", "")),
            amount=str(data.get("amount", "")),
            signed_transaction=str(data.get("signedTransaction", "")),
            version=str(data.get("version", "")),
        )


@dataclass
class Erc20ApprovalGasSponsoringServerInfo:
    description: str
    version: str


@dataclass
class Erc20ApprovalGasSponsoringExtensionInfo:
    info: Erc20ApprovalGasSponsoringInfo | Erc20ApprovalGasSponsoringServerInfo
    schema: dict[str, Any]
