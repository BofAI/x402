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

    async def check_balance(self, token: str, network: str) -> int:
        """Check token balance for this mechanism's payment scheme.

        Default delegates to the signer's own address.
        Override in subclasses where the balance location differs
        (e.g., gasfree wallets).
        """
        signer = self.get_signer()
        if signer is None:
            return 0
        return await signer.check_balance(token, network)

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
