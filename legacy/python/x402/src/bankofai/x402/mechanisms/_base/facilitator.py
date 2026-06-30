"""
Facilitator mechanism base interface
"""

from abc import ABC, abstractmethod
from typing import Any

from bankofai.x402.types import (
    FeeQuoteResponse,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)


class FacilitatorMechanism(ABC):
    """
    Abstract base class for facilitator payment mechanisms.

    Responsible for verifying signatures and executing settlements.
    """

    @abstractmethod
    def scheme(self) -> str:
        """Get the payment scheme name"""
        pass

    @abstractmethod
    async def fee_quote(
        self,
        accept: PaymentRequirements,
        context: dict[str, Any] | None = None,
    ) -> FeeQuoteResponse:
        """
        Calculate fee quote for payment requirements.

        Args:
            accept: Payment requirements
            context: Optional payment context

        Returns:
            FeeQuoteResponse with fee information
        """
        pass

    @abstractmethod
    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        """
        Verify payment signature (without executing on-chain transaction).

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            VerifyResponse
        """
        pass

    @abstractmethod
    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """
        Execute payment settlement (on-chain transaction).

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            SettleResponse with tx_hash
        """
        pass
