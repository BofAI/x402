"""TRON facilitator scheme for the Exact payment mechanism (v2 Python SDK)."""

from typing import Any

from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import SCHEME_EXACT
from ..signer import FacilitatorTronSigner
from ..types import ExactPermit2Payload, is_permit2_payload
from .eip3009 import settle_eip3009, verify_eip3009
from .permit2 import settle_permit2, verify_permit2


class ExactTronScheme:
    """TRON facilitator for the Exact payment scheme."""

    scheme = SCHEME_EXACT
    caip_family = "tron:*"

    def __init__(self, signer: FacilitatorTronSigner) -> None:
        self._signer = signer

    def get_extra(self, network: str) -> dict[str, Any] | None:
        signers = self._signer.get_addresses()
        if signers:
            return {"permit2FacilitatorAddress": signers[0]}
        return None

    def get_signers(self, network: str) -> list[str]:
        return list(self._signer.get_addresses())

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> VerifyResponse:
        raw: dict[str, Any] = payload.payload or {}
        if is_permit2_payload(raw):
            return verify_permit2(
                self._signer,
                payload,
                requirements,
                ExactPermit2Payload.from_dict(raw),
                context,
            )
        return verify_eip3009(self._signer, payload, requirements, raw)

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context: Any = None,
    ) -> SettleResponse:
        raw: dict[str, Any] = payload.payload or {}
        if is_permit2_payload(raw):
            return settle_permit2(
                self._signer,
                payload,
                requirements,
                ExactPermit2Payload.from_dict(raw),
                context,
            )
        return settle_eip3009(self._signer, payload, requirements, raw)
