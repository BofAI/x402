"""
ExactTronClientMechanism - exact client mechanism for TRON.
"""

from typing import TYPE_CHECKING

from bankofai.x402.mechanisms._exact_base.base import ExactBaseClientMechanism
from bankofai.x402.mechanisms.tron.exact.adapter import TronChainAdapter

if TYPE_CHECKING:
    from bankofai.x402.signers.client import ClientSigner


class ExactTronClientMechanism(ExactBaseClientMechanism):
    """TransferWithAuthorization client mechanism for TRON."""

    def __init__(self, signer: "ClientSigner") -> None:
        super().__init__(signer, TronChainAdapter())
