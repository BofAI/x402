"""
ExactGasFreeServerMechanism - GasFree payment scheme server mechanism for TRON.
"""

from typing import Any

from bankofai.x402.mechanisms.tron.exact_permit.server import ExactPermitTronServerMechanism


class ExactGasFreeServerMechanism(ExactPermitTronServerMechanism):
    """
    Server mechanism for the "exact_gasfree" scheme.

    Inherits from ExactPermitTronServerMechanism to reuse TRON-specific
    address and price handling logic, but delegates all signature
    verification to the Facilitator.
    """

    def scheme(self) -> str:
        return "exact_gasfree"

    async def verify_signature(
        self,
        permit: Any,
        signature: str,
        network: str,
    ) -> bool:
        """
        Skip local server-side cryptographic verification for GasFree.
        Always returns True to allow the request to proceed to the Facilitator
        for authoritative verification.
        """
        return True
