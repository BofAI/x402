"""Asset registry for the x402 Python SDK.

Provides a centralized registry of known token assets across networks,
allowing symbol-based lookup instead of manual address specification.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .schemas.base import Network


@dataclass
class AssetInfo:
    """Information about a token asset on a specific network.

    Attributes:
        address: Token contract address.
        decimals: Number of decimal places.
        name: EIP-712 domain name (optional).
        version: EIP-712 domain version (optional).
        asset_transfer_method: Transfer method (e.g., "permit2").
        supports_eip2612: Whether token supports EIP-2612.
        extra: Additional metadata.
    """

    address: str
    decimals: int
    name: str | None = None
    version: str | None = None
    asset_transfer_method: str | None = None
    supports_eip2612: bool | None = None
    extra: dict[str, Any] = field(default_factory=dict)


class AssetRegistry:
    """Registry of known token assets across networks.

    Provides symbol-based lookup for token metadata, with built-in
    knowledge of common tokens on supported networks.
    """

    def __init__(self) -> None:
        # network -> symbol -> AssetInfo
        self._assets: dict[str, dict[str, AssetInfo]] = {}
        # network -> default symbol
        self._defaults: dict[str, str] = {}
        self._register_builtins()

    def register(self, network: Network, symbol: str, info: AssetInfo) -> None:
        """Register a single asset for a network."""
        if network not in self._assets:
            self._assets[network] = {}
        self._assets[network][symbol] = info

    def register_all(
        self, network: Network, assets: dict[str, AssetInfo]
    ) -> None:
        """Batch-register multiple assets for a network."""
        for symbol, info in assets.items():
            self.register(network, symbol, info)

    def set_default(self, network: Network, symbol: str) -> None:
        """Set the default asset symbol for a network."""
        if not self.has(network, symbol):
            raise ValueError(
                f'Cannot set default: asset "{symbol}" is not registered '
                f'on network "{network}"'
            )
        self._defaults[network] = symbol

    def resolve(self, network: Network, symbol: str) -> AssetInfo:
        """Resolve a symbol to its AssetInfo on a network.

        Raises:
            KeyError: If the symbol is not registered on the network.
        """
        network_assets = self._assets.get(network)
        if network_assets is None or symbol not in network_assets:
            available = (
                ", ".join(network_assets.keys()) if network_assets else "none"
            )
            raise KeyError(
                f'Asset "{symbol}" is not registered on network "{network}". '
                f"Available: {available}"
            )
        return network_assets[symbol]

    def get_default(self, network: Network) -> tuple[str, AssetInfo]:
        """Get the default asset for a network.

        Returns:
            Tuple of (symbol, AssetInfo).

        Raises:
            KeyError: If no default is configured for the network.
        """
        symbol = self._defaults.get(network)
        if symbol is None:
            raise KeyError(
                f'No default asset configured for network "{network}"'
            )
        return symbol, self.resolve(network, symbol)

    def get_symbols(self, network: Network) -> list[str]:
        """List all registered symbols for a network."""
        network_assets = self._assets.get(network)
        return list(network_assets.keys()) if network_assets else []

    def has(self, network: Network, symbol: str) -> bool:
        """Check if an asset is registered on a network."""
        return symbol in self._assets.get(network, {})

    def _register_builtins(self) -> None:
        """Register built-in known assets.

        Data sourced from EVM mechanism's getDefaultAsset() and
        x402-deprecated token registry.
        """
        # ── EVM Networks ──────────────────────────────────────────

        # eip155:1 — Ethereum Mainnet
        self.register_all(
            "eip155:1",
            {
                "USDC": AssetInfo(
                    address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
                    decimals=6,
                    name="USD Coin",
                    version="2",
                ),
                "USDT": AssetInfo(
                    address="0xdAC17F958D2ee523a2206206994597C13D831ec7",
                    decimals=6,
                    name="Tether USD",
                    version="1",
                    asset_transfer_method="permit2",
                ),
            },
        )
        self._defaults["eip155:1"] = "USDC"

        # eip155:56 — BSC Mainnet (BEP-20, no EIP-3009/EIP-2612)
        self.register_all(
            "eip155:56",
            {
                "USDC": AssetInfo(
                    address="0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
                    decimals=18,
                    name="USD Coin",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "USDT": AssetInfo(
                    address="0x55d398326f99059fF775485246999027B3197955",
                    decimals=18,
                    name="Tether USD",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "EPS": AssetInfo(
                    address="0xA7f552078dcC247C2684336020c03648500C6d9F",
                    decimals=18,
                    name="Ellipsis",
                    version="1",
                    asset_transfer_method="permit2",
                ),
            },
        )
        self._defaults["eip155:56"] = "USDC"

        # eip155:97 — BSC Testnet (BEP-20, no EIP-3009/EIP-2612)
        self.register_all(
            "eip155:97",
            {
                "USDT": AssetInfo(
                    address="0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
                    decimals=18,
                    name="Tether USD",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "USDC": AssetInfo(
                    address="0x64544969ed7EBf5f083679233325356EbE738930",
                    decimals=18,
                    name="USD Coin",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "DHLU": AssetInfo(
                    address="0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
                    decimals=6,
                    name="DA HULU",
                    version="1",
                    asset_transfer_method="permit2",
                ),
            },
        )
        self._defaults["eip155:97"] = "USDT"

        # ── TRON Networks ─────────────────────────────────────────

        # tron:mainnet
        self.register_all(
            "tron:mainnet",
            {
                "USDT": AssetInfo(
                    address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
                    decimals=6,
                    name="Tether USD",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "USDD": AssetInfo(
                    address="TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
                    decimals=18,
                    name="Decentralized USD",
                    version="1",
                    supports_eip2612=True,
                ),
            },
        )
        self._defaults["tron:mainnet"] = "USDT"

        # tron:shasta
        self.register(
            "tron:shasta",
            "USDT",
            AssetInfo(
                address="TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
                decimals=6,
                name="Tether USD",
                version="1",
                asset_transfer_method="permit2",
            ),
        )
        self._defaults["tron:shasta"] = "USDT"

        # tron:nile
        self.register_all(
            "tron:nile",
            {
                "USDT": AssetInfo(
                    address="TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
                    decimals=6,
                    name="Tether USD",
                    version="1",
                    asset_transfer_method="permit2",
                ),
                "USDD": AssetInfo(
                    address="TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK",
                    decimals=18,
                    name="Decentralized USD",
                    version="1",
                    supports_eip2612=True,
                ),
            },
        )
        self._defaults["tron:nile"] = "USDT"


def convert_money(price: str | int | float, decimals: int) -> str:
    """Convert a Money value to token smallest-unit string.

    Args:
        price: User-friendly price (e.g., "$1.50", 1.5, "0.10").
        decimals: Token decimal places.

    Returns:
        Amount in smallest unit as string.

    Raises:
        ValueError: If price format is invalid.
    """
    if isinstance(price, str):
        cleaned = price.lstrip("$").strip()
        try:
            numeric = float(cleaned)
        except ValueError:
            raise ValueError(f"Invalid money format: {price}") from None
    else:
        numeric = float(price)

    # Use string math to avoid floating point issues
    str_amount = str(numeric)
    if "." in str_amount:
        int_part, dec_part = str_amount.split(".")
    else:
        int_part, dec_part = str_amount, ""

    padded_dec = (dec_part + "0" * decimals)[:decimals]
    result = (int_part + padded_dec).lstrip("0") or "0"
    return result


#: Global shared AssetRegistry instance with built-in token data.
#: Used by default in x402ResourceServer. Developers can register
#: custom tokens on this instance or create their own if isolation is needed.
global_asset_registry = AssetRegistry()
