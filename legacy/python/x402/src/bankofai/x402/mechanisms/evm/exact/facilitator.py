"""
ExactEvmFacilitatorMechanism - exact facilitator mechanism for EVM.
"""

from typing import TYPE_CHECKING

from bankofai.x402.mechanisms._exact_base.base import ExactBaseFacilitatorMechanism
from bankofai.x402.mechanisms.evm.exact.adapter import EvmChainAdapter

if TYPE_CHECKING:
    from bankofai.x402.signers.facilitator import FacilitatorSigner


class ExactEvmFacilitatorMechanism(ExactBaseFacilitatorMechanism):
    """TransferWithAuthorization facilitator mechanism for EVM."""

    def __init__(
        self,
        signer: "FacilitatorSigner",
        allowed_tokens: set[str] | None = None,
    ) -> None:
        super().__init__(signer, EvmChainAdapter(), allowed_tokens)
