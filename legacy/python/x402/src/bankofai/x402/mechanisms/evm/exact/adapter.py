"""
EVM chain adapter for exact.
"""

from bankofai.x402.mechanisms._exact_base.base import ChainAdapter


class EvmChainAdapter(ChainAdapter):
    """Chain adapter for EVM-compatible networks (eip155:<chainId>)."""

    def parse_chain_id(self, network: str) -> int:
        if not network.startswith("eip155:"):
            raise ValueError(f"Not an EVM network: {network}")
        return int(network.split(":", 1)[1])

    def validate_network(self, network: str) -> bool:
        return network.startswith("eip155:")

    def validate_address(self, address: str) -> bool:
        return address.startswith("0x")

    def normalize_address(self, address: str) -> str:
        return address.lower()

    def to_signing_address(self, address: str) -> str:
        return address
