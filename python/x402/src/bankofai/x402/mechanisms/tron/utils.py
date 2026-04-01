"""TRON utility functions — address conversion and chain helpers."""

import os
from decimal import Decimal

from .constants import TRON_CHAIN_IDS, TRON_NETWORK_CONFIGS, AssetInfo, NetworkConfig


def get_tron_chain_id(network: str) -> int:
    """Return numeric TIP-712 chain ID for a tron:<net> network string."""
    if not network.startswith("tron:"):
        raise ValueError(f"Unsupported network format: {network} (expected tron:*)")
    chain_id = TRON_CHAIN_IDS.get(network)
    if chain_id is None:
        raise ValueError(f"Unknown TRON network: {network}")
    return chain_id


def get_network_config(network: str) -> NetworkConfig:
    """Get configuration for a TRON network identifier."""
    if network in TRON_NETWORK_CONFIGS:
        return TRON_NETWORK_CONFIGS[network]
    if network.startswith("tron:"):
        raise ValueError(f"Unknown TRON network: {network}")
    raise ValueError(f"Unsupported network format: {network} (expected tron:*)")


def get_asset_info(network: str, asset_address: str) -> AssetInfo:
    """Get asset info by address.

    Searches default_asset first, then additional registered assets.
    """
    config = get_network_config(network)
    default = config.get("default_asset")
    if default and default["address"].lower() == asset_address.lower():
        return default
    for asset in config.get("assets", []):
        if asset["address"].lower() == asset_address.lower():
            return asset
    raise ValueError(f"Token {asset_address} is not a registered asset for network {network}.")


def tron_address_to_evm(address: str) -> str:
    """Convert TRON Base58Check address to 0x-prefixed EVM hex address."""
    from tronpy.keys import to_hex_address  # type: ignore

    if address.startswith("0x"):
        return address.lower()
    if address.startswith("41") and len(address) == 42:
        return f"0x{address[2:].lower()}"
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


def normalize_address_for_contract_call(address: str) -> str:
    """Normalize address to TRON base58 format for tronpy contract calls."""
    from tronpy.keys import to_base58check_address  # type: ignore

    if address.startswith("T") and len(address) == 34:
        return address
    if address.startswith("0x") and len(address) == 42:
        return to_base58check_address("41" + address[2:])
    if address.startswith("41") and len(address) == 42:
        return to_base58check_address(address)
    raise ValueError(f"Unrecognized address format: {address}")


def is_tron_address(address: str) -> bool:
    """Return True if address looks like a TRON Base58Check address."""
    return address.startswith("T") and len(address) == 34


def parse_amount(amount: str, decimals: int) -> int:
    """Convert decimal string to smallest unit (sun).

    Args:
        amount: Decimal string (e.g., "0.01").
        decimals: Token decimals.

    Returns:
        Amount in smallest unit.
    """
    d = Decimal(amount)
    multiplier = Decimal(10**decimals)
    return int(d * multiplier)


def create_nonce() -> str:
    """Generate a random 32-byte hex nonce (0x-prefixed)."""
    return "0x" + os.urandom(32).hex()
