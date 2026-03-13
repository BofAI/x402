"""TRON facilitator scheme for the Exact payment mechanism (v2 Python SDK).

Mirrors ExactTronScheme from TypeScript: routes between TIP-712 (eip3009)
and Permit2 based on the payload structure (permit2Authorization vs authorization).
"""

from typing import Any

from ....schemas import (
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from ..constants import (
    SCHEME_EXACT,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signers import FacilitatorTronSigner
from .eip3009 import settle_eip3009, verify_eip3009
from .permit2 import settle_permit2, verify_permit2


def _is_permit2_payload(raw: dict[str, Any]) -> bool:
    """Return True if the raw payload uses the Permit2 path (has permit2Authorization)."""
    return "permit2Authorization" in raw


class ExactTronScheme:
    """TRON facilitator for the Exact payment scheme.

    Thin router that delegates to TIP-712 (eip3009) or Permit2
    based on payload type — identical to the TypeScript ExactTronScheme.

    Attributes:
        scheme: Always "exact".
        caip_family: Always "tron:*".
    """

    scheme = SCHEME_EXACT
    caip_family = "tron:*"

    def __init__(self, signer: FacilitatorTronSigner) -> None:
        self._signer = signer

    def get_extra(self, network: str) -> dict[str, Any] | None:
        """Return supported asset transfer methods and Permit2 proxy address."""
        supported_methods = ["eip3009"]
        signers = self._signer.get_addresses()
        if X402_PERMIT2_PROXY_ADDRESSES.get(network):
            supported_methods.append("permit2")

        extra: dict[str, Any] = {"supportedAssetTransferMethods": supported_methods}
        if signers and X402_PERMIT2_PROXY_ADDRESSES.get(network):
            extra["permit2FacilitatorAddress"] = signers[0]
        return extra

    def get_signers(self, network: str) -> list[str]:
        """Return facilitator wallet addresses."""
        return list(self._signer.get_addresses())

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> VerifyResponse:
        """Verify — routes to Permit2 or eip3009 based on payload type."""
        raw: dict[str, Any] = payload.payload or {}
        if _is_permit2_payload(raw):
            return verify_permit2(self._signer, payload, requirements, raw)
        return verify_eip3009(self._signer, payload, requirements, raw)

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> SettleResponse:
        """Settle — routes to Permit2 or eip3009 based on payload type."""
        raw: dict[str, Any] = payload.payload or {}
        if _is_permit2_payload(raw):
            return settle_permit2(self._signer, payload, requirements, raw)
        return settle_eip3009(self._signer, payload, requirements, raw)
