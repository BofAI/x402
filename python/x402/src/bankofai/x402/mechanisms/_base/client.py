"""
Client mechanism base interface
"""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from bankofai.x402.types import PaymentPayload, PaymentRequirements

if TYPE_CHECKING:
    from bankofai.x402.signers.client.base import ClientSigner


class ClientMechanism(ABC):
    """
    Abstract base class for client payment mechanisms.

    Responsible for creating payment payloads for specific chains/schemes.
    """

    @abstractmethod
    def scheme(self) -> str:
        """Get the payment scheme name"""
        pass

    def get_signer(self) -> "ClientSigner | None":
        """Return the signer used by this mechanism, if any.

        Used by X402Client to auto-register balance-aware policies.
        Subclasses holding a signer should override this method.
        """
        return None

    async def resolve_balance_check_context(
        self,
        requirements: PaymentRequirements,
    ) -> dict[str, int | str] | None:
        """Resolve a scheme-specific balance check context.

        Return a dict with:
        - address: address to check balance against
        - extra_needed: extra amount (e.g. fees) to add to required amount
        """
        return None

    @abstractmethod
    async def create_payment_payload(
        self,
        requirements: PaymentRequirements,
        resource: str,
        extensions: dict[str, Any] | None = None,
    ) -> PaymentPayload:
        """
        Create a payment payload for the given requirements.

        Args:
            requirements: Payment requirements from server
            resource: Resource URL
            extensions: Optional extensions (e.g., paymentPermitContext)

        Returns:
            PaymentPayload with signature
        """
        pass
