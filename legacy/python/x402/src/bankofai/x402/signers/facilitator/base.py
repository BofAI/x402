"""
Facilitator signer base interface
"""

from abc import ABC, abstractmethod
from typing import Any


class FacilitatorSigner(ABC):
    """
    Abstract base class for facilitator signers.

    Responsible for verifying signatures and executing on-chain transactions.
    """

    @abstractmethod
    def get_address(self) -> str:
        """Get the facilitator's account address"""
        pass

    @abstractmethod
    async def verify_typed_data(
        self,
        address: str,
        domain: dict[str, Any],
        types: dict[str, Any],
        message: dict[str, Any],
        signature: str,
        primary_type: str,
    ) -> bool:
        """
        Verify EIP-712 typed data signature.

        Args:
            address: Expected signer address
            domain: EIP-712 domain
            types: Type definitions
            message: Signed message
            signature: Signature to verify
            primary_type: The root type name of the message

        Returns:
            True if signature is valid
        """
        pass

    @abstractmethod
    async def write_contract(
        self,
        contract_address: str,
        abi: str,
        method: str,
        args: list[Any],
        network: str,
    ) -> str | None:
        """
        Execute a contract write transaction.

        Args:
            contract_address: Contract address
            abi: Contract ABI (JSON string)
            method: Method name
            args: Method arguments
            network: Network identifier (e.g. "tron:nile")

        Returns:
            Transaction hash, or None on failure
        """
        pass

    @abstractmethod
    async def check_balance(
        self,
        token: str,
        network: str,
        address: str | None = None,
    ) -> int:
        """
        Check token balance.

        Args:
            token: Token contract address
            network: Network identifier
            address: Optional address to check. Defaults to signer's address.

        Returns:
            Current balance (raw units)
        """
        pass

    @abstractmethod
    async def wait_for_transaction_receipt(
        self,
        tx_hash: str,
        timeout: int = 120,
        network: str = "",
    ) -> dict[str, Any]:
        """
        Wait for transaction confirmation.

        Args:
            tx_hash: Transaction hash
            timeout: Timeout in seconds
            network: Network identifier (e.g. "tron:nile")

        Returns:
            Transaction receipt
        """
        pass
