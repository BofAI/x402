"""
TRON chain adapter for exact.
"""

from bankofai.x402.address import TronAddressConverter
from bankofai.x402.config import NetworkConfig
from bankofai.x402.mechanisms._exact_base.base import ChainAdapter


class TronChainAdapter(ChainAdapter):
    """Chain adapter for TRON networks (tron:<network>)."""

    def __init__(self) -> None:
        self._converter = TronAddressConverter()

    def parse_chain_id(self, network: str) -> int:
        return NetworkConfig.get_chain_id(network)

    def validate_network(self, network: str) -> bool:
        return network.startswith("tron:")

    def validate_address(self, address: str) -> bool:
        return address.startswith("T")

    def normalize_address(self, address: str) -> str:
        return self._converter.normalize(address)

    def to_signing_address(self, address: str) -> str:
        return self._converter.to_evm_format(address)
