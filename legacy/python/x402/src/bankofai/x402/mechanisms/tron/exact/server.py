"""
ExactTronServerMechanism - exact server mechanism for TRON.
"""

from bankofai.x402.mechanisms._exact_base.base import ExactBaseServerMechanism
from bankofai.x402.mechanisms.tron.exact.adapter import TronChainAdapter


class ExactTronServerMechanism(ExactBaseServerMechanism):
    """TransferWithAuthorization server mechanism for TRON."""

    def __init__(self) -> None:
        super().__init__(TronChainAdapter())
