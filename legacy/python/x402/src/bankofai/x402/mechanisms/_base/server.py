"""
Server mechanism base interface
"""

from abc import ABC, abstractmethod
from typing import Any

from bankofai.x402.types import PaymentRequirements


class ServerMechanism(ABC):
    """
    Abstract base class for server payment mechanisms.

    Responsible for parsing prices and enhancing payment requirements.
    """

    @abstractmethod
    def scheme(self) -> str:
        """Get the payment scheme name"""
        pass

    @abstractmethod
    async def parse_price(self, price: str, network: str) -> dict[str, Any]:
        """
        Parse a price string into asset amount.

        Args:
            price: Price string (e.g., "100 USDC", "0.01 ETH")
            network: Network identifier

        Returns:
            Dict containing amount, asset, decimals
        """
        pass

    @abstractmethod
    async def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        kind: str,
    ) -> PaymentRequirements:
        """
        Enhance payment requirements with metadata.

        Args:
            requirements: Base payment requirements
            kind: Delivery mode (PAYMENT_ONLY or PAYMENT_AND_DELIVERY)

        Returns:
            Enhanced PaymentRequirements
        """
        pass

    @abstractmethod
    def validate_payment_requirements(self, requirements: PaymentRequirements) -> bool:
        """
        Validate payment requirements.

        Args:
            requirements: Payment requirements to validate

        Returns:
            True if valid
        """
        pass

    @abstractmethod
    async def verify_signature(
        self,
        permit: Any,
        signature: str,
        network: str,
    ) -> bool:
        """
        Verify payment permit signature.

        Args:
            permit: Payment permit to verify
            signature: Signature string
            network: Network identifier

        Returns:
            True if signature is valid
        """
        pass
