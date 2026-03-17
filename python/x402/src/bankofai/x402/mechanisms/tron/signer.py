"""TRON signer protocol definitions."""

from typing import Any, Protocol


class ClientTronSigner(Protocol):
    """Client-side TRON signer for payment authorizations."""

    @property
    def address(self) -> str:
        ...

    def sign_typed_data(
        self,
        domain: dict[str, Any],
        types: dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
    ) -> str:
        ...

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
    ) -> Any:
        ...

    def build_trigger_smart_contract_transaction(self, **kwargs: Any) -> Any:
        ...

    def sign_transaction(self, transaction: Any) -> Any:
        ...


class FacilitatorTronSigner(Protocol):
    """Facilitator-side TRON signer for verification and settlement."""

    def get_addresses(self) -> list[str]:
        ...

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
    ) -> Any:
        ...

    def verify_typed_data(
        self,
        address: str,
        domain: dict[str, Any],
        types: dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
        signature: str,
    ) -> bool:
        ...

    def write_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any],
        fee_limit: int = 1_000_000_000,
    ) -> str:
        ...

    def write_contract_with_abi(
        self,
        address: str,
        function_name: str,
        args: list[Any],
        abi: list[dict[str, Any]],
        fee_limit: int = 1_000_000_000,
    ) -> str:
        ...

    def wait_for_transaction_receipt(self, tx_hash: str):
        ...

    def send_raw_transaction(self, signed_transaction: dict[str, Any]) -> str:
        ...

    def get_sign_weight(self, transaction: Any) -> Any:
        ...
