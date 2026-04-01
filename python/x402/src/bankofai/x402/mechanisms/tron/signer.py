"""TRON signer protocol definitions."""

from typing import Any, Protocol

from .types import TypedDataDomain, TypedDataField


class ClientTronSigner(Protocol):
    """Client-side TRON signer for payment authorizations."""

    @property
    def address(self) -> str:
        """The signer's TRON address (base58 or 0x hex).

        Returns:
            TRON address string.
        """
        ...

    def sign_typed_data(
        self,
        domain: TypedDataDomain | dict[str, Any],
        types: dict[str, list[TypedDataField]] | dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
    ) -> str:
        """Sign TIP-712 typed data.

        Args:
            domain: TIP-712 domain separator.
            types: Type definitions.
            primary_type: Primary type name.
            message: Message data.

        Returns:
            Hex-encoded signature string (0x...).
        """
        ...

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
        abi: list[dict[str, Any]] | None = None,
    ) -> Any:
        """Read data from a smart contract.

        Args:
            address: Contract address (TRON base58 or 0x hex).
            function_name: Function to call.
            args: Function arguments.
            abi: Optional ABI for functions not in on-chain ABI.

        Returns:
            Function return value.
        """
        ...

    def build_trigger_smart_contract_transaction(self, **kwargs: Any) -> Any: ...

    def sign_transaction(self, transaction: Any) -> Any: ...


class FacilitatorTronSigner(Protocol):
    """Facilitator-side TRON signer for verification and settlement."""

    def get_addresses(self) -> list[str]:
        """Get all addresses this facilitator can use.

        Returns:
            List of TRON addresses.
        """
        ...

    def read_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any] | None = None,
        abi: list[dict[str, Any]] | None = None,
    ) -> Any:
        """Read data from a smart contract.

        Args:
            address: Contract address (TRON base58 or 0x hex).
            function_name: Function to call.
            args: Function arguments.
            abi: Optional ABI for functions not in on-chain ABI.

        Returns:
            Function return value.
        """
        ...

    def verify_typed_data(
        self,
        address: str,
        domain: TypedDataDomain | dict[str, Any],
        types: dict[str, list[TypedDataField]] | dict[str, list[dict[str, str]]],
        primary_type: str,
        message: dict[str, Any],
        signature: str,
    ) -> bool:
        """Verify a TIP-712 signature.

        Args:
            address: Expected signer address.
            domain: TIP-712 domain separator.
            types: Type definitions.
            primary_type: Primary type name.
            message: Message data.
            signature: Hex-encoded signature string (0x...).

        Returns:
            True if signature is valid.
        """
        ...

    def write_contract(
        self,
        address: str,
        function_name: str,
        args: list[Any],
        fee_limit: int = 1_000_000_000,
    ) -> str:
        """Execute a smart contract transaction.

        Args:
            address: Contract address.
            function_name: Function to call.
            args: Function arguments.
            fee_limit: Maximum fee in sun.

        Returns:
            Transaction hash.
        """
        ...

    def write_contract_with_abi(
        self,
        address: str,
        function_name: str,
        args: list[Any],
        abi: list[dict[str, Any]],
        fee_limit: int = 1_000_000_000,
    ) -> str:
        """Execute a smart contract transaction with explicit ABI.

        Args:
            address: Contract address.
            function_name: Function to call.
            args: Function arguments.
            abi: Contract ABI.
            fee_limit: Maximum fee in sun.

        Returns:
            Transaction hash.
        """
        ...

    def wait_for_transaction_receipt(self, tx_hash: str): ...

    def send_raw_transaction(self, signed_transaction: dict[str, Any]) -> str:
        """Broadcast a pre-signed transaction.

        Args:
            signed_transaction: Signed transaction dict.

        Returns:
            Transaction hash.
        """
        ...

    def get_sign_weight(self, transaction: Any) -> Any:
        """Check signature weight of a transaction (for multisig validation).

        Args:
            transaction: Transaction to check.

        Returns:
            Sign weight result.
        """
        ...
