"""
Signer utility functions
"""

from typing import Any

from bankofai.x402.config import NetworkConfig

# Canonical EIP-712 domain field order and types
_EIP712_DOMAIN_FIELDS: list[tuple[str, str]] = [
    ("name", "string"),
    ("version", "string"),
    ("chainId", "uint256"),
    ("verifyingContract", "address"),
    ("salt", "bytes32"),
]


def _eip712_domain_type_from_keys(domain: dict[str, Any]) -> list[dict[str, str]]:
    """Build an EIP712Domain type array from the keys present in *domain*.

    Preserves the canonical field order defined in EIP-712.
    """
    return [{"name": name, "type": typ} for name, typ in _EIP712_DOMAIN_FIELDS if name in domain]


def resolve_provider_uri(network: str) -> str | None:
    """Resolve a network identifier to an RPC provider URI.

    Checks in order:
    1. If network is already an HTTP/WS URL, return as-is
    2. Look up in NetworkConfig.RPC_URLS
    3. Return None (no provider available)

    Args:
        network: Network identifier (e.g., "eip155:97") or direct URL

    Returns:
        Provider URI string, or None if not resolvable
    """
    if network.startswith(("http://", "https://", "ws://", "wss://")):
        return network
    return NetworkConfig.get_rpc_url(network)
