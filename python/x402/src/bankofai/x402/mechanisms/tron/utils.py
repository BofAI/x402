"""TRON utility functions — address conversion and chain helpers."""

from .constants import TRON_CHAIN_IDS


def get_tron_chain_id(network: str) -> int:
    """Return numeric TIP-712 chain ID for a tron:<net> network string."""
    if not network.startswith("tron:"):
        raise ValueError(f"Unsupported network format: {network} (expected tron:*)")
    chain_id = TRON_CHAIN_IDS.get(network)
    if chain_id is None:
        raise ValueError(f"Unknown TRON network: {network}")
    return chain_id


def tron_address_to_evm(address: str) -> str:
    """Convert TRON Base58Check address to 0x-prefixed EVM hex address."""
    from tronpy.keys import to_hex_address  # type: ignore # tronpy helper

    if address.startswith("0x"):
        return address.lower()
    if address.startswith("41") and len(address) == 42:
        return f"0x{address[2:].lower()}"
    # Base58Check → hex via tronpy
    hex_addr = to_hex_address(address)  # returns "41xxxx..."
    return f"0x{hex_addr[2:].lower()}"


def normalize_address_for_signing(address: str) -> str:
    """Normalize TRON or EVM address to lowercase 0x hex for TIP-712 signing."""
    if address.startswith("T") and len(address) == 34:
        return tron_address_to_evm(address)
    if address.startswith("0x"):
        return address.lower()
    if address.startswith("41") and len(address) == 42:
        return f"0x{address[2:].lower()}"
    raise ValueError(f"Unrecognized address format: {address}")


def is_tron_address(address: str) -> bool:
    """Return True if address looks like a TRON Base58Check address."""
    return address.startswith("T") and len(address) == 34


def create_nonce() -> str:
    """Generate a random 32-byte hex nonce (0x-prefixed)."""
    import os

    return "0x" + os.urandom(32).hex()
