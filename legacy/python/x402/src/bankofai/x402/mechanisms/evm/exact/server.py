"""
ExactEvmServerMechanism - exact server mechanism for EVM.
"""

from bankofai.x402.mechanisms._exact_base.base import ExactBaseServerMechanism
from bankofai.x402.mechanisms.evm.exact.adapter import EvmChainAdapter


class ExactEvmServerMechanism(ExactBaseServerMechanism):
    """TransferWithAuthorization server mechanism for EVM."""

    def __init__(self) -> None:
        super().__init__(EvmChainAdapter())
