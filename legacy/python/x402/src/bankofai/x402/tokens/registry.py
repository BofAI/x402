"""
Token registry - Centralized management of token configurations for all networks
"""

from dataclasses import dataclass
from typing import Any

from bankofai.x402.address.converter import TronAddressConverter
from bankofai.x402.exceptions import UnknownTokenError

_converter = TronAddressConverter()


@dataclass
class TokenInfo:
    """Token information"""

    address: str
    decimals: int
    name: str
    symbol: str
    version: str = "1"


class TokenRegistry:
    """Token registry"""

    _tokens: dict[str, dict[str, TokenInfo]] = {
        # BSC Testnet (eip155:97)
        "eip155:97": {
            "USDT": TokenInfo(
                address="0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
                decimals=18,
                name="Tether USD",
                symbol="USDT",
            ),
            "USDC": TokenInfo(
                address="0x64544969ed7EBf5f083679233325356EbE738930",
                decimals=18,
                name="USD Coin",
                symbol="USDC",
            ),
            "DHLU": TokenInfo(
                address="0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
                decimals=6,
                name="DA HULU",
                symbol="DHLU",
            ),
        },
        # BSC Mainnet (eip155:56)
        "eip155:56": {
            "USDC": TokenInfo(
                address="0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
                decimals=18,
                name="USD Coin",
                symbol="USDC",
            ),
            "USDT": TokenInfo(
                address="0x55d398326f99059fF775485246999027B3197955",
                decimals=18,
                name="Tether USD",
                symbol="USDT",
            ),
            "EPS": TokenInfo(
                address="0xA7f552078dcC247C2684336020c03648500C6d9F",
                decimals=18,
                name="Ellipsis",
                symbol="EPS",
            ),
        },
        # TRON Networks
        "tron:mainnet": {
            "USDT": TokenInfo(
                address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
                decimals=6,
                name="Tether USD",
                symbol="USDT",
            ),
            "USDD": TokenInfo(
                address="TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz",
                decimals=18,
                name="Decentralized USD",
                symbol="USDD",
            ),
        },
        "tron:shasta": {
            "USDT": TokenInfo(
                address="TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
                decimals=6,
                name="Tether USD",
                symbol="USDT",
            ),
        },
        "tron:nile": {
            "USDT": TokenInfo(
                address="TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
                decimals=6,
                name="Tether USD",
                symbol="USDT",
            ),
            "USDD": TokenInfo(
                address="TGjgvdTWWrybVLaVeFqSyVqJQWjxqRYbaK",
                decimals=18,
                name="Decentralized USD",
                symbol="USDD",
            ),
        },
    }

    @classmethod
    def register_token(cls, network: str, token: TokenInfo) -> None:
        """Register a custom token for specified network

        Args:
            network: Network identifier (e.g. "tron:nile", "eip155:97")
            token: TokenInfo to register
        """
        if network not in cls._tokens:
            cls._tokens[network] = {}
        # Only normalize TRON addresses; EVM addresses stay as-is
        if not network.startswith("eip155:"):
            token.address = _converter.normalize(token.address)
        cls._tokens[network][token.symbol.upper()] = token

    @classmethod
    def get_token(cls, network: str, symbol: str) -> TokenInfo:
        """Get token information for specified network and symbol

        Raises:
            UnknownTokenError: If token does not exist
        """
        tokens = cls._tokens.get(network, {})
        token = tokens.get(symbol.upper())
        if token is None:
            raise UnknownTokenError(f"Unknown token {symbol} on network {network}")
        return token

    @classmethod
    def find_by_address(cls, network: str, address: str) -> TokenInfo | None:
        """Find token information by address"""
        tokens = cls._tokens.get(network, {})
        # Use case-insensitive comparison for EVM addresses
        if network.startswith("eip155:"):
            lower = address.lower()
            for info in tokens.values():
                if info.address.lower() == lower:
                    return info
            return None
        normalized = _converter.normalize(address)
        for info in tokens.values():
            if info.address == normalized:
                return info
        return None

    @classmethod
    def get_network_tokens(cls, network: str) -> dict[str, TokenInfo]:
        """Get all tokens for specified network"""
        return cls._tokens.get(network, {})

    @classmethod
    def get_network_token_addresses(cls, network: str) -> set[str]:
        """Get all token addresses for specified network.

        Returns:
            Set of token contract addresses
        """
        tokens = cls._tokens.get(network, {})
        return {info.address for info in tokens.values()}

    @classmethod
    def get_network_tokens_by_symbol(cls, symbol: str) -> list[TokenInfo]:
        """Find all tokens across networks matching the given symbol.

        Args:
            symbol: Token symbol (e.g. "USDT")

        Returns:
            List of matching TokenInfo (empty if none found)
        """
        results: list[TokenInfo] = []
        upper = symbol.upper()
        for tokens in cls._tokens.values():
            if upper in tokens:
                results.append(tokens[upper])
        return results

    @classmethod
    def all_symbols(cls) -> set[str]:
        """Return all known token symbols across all networks."""
        symbols: set[str] = set()
        for tokens in cls._tokens.values():
            symbols.update(tokens.keys())
        return symbols

    @classmethod
    def parse_price(cls, price: str, network: str) -> dict[str, Any]:
        """Parse price string into asset amount

        Args:
            price: Price string (e.g. "100 USDC")
            network: Network identifier

        Returns:
            Dictionary containing amount, asset, decimals, etc.
        """
        parts = price.strip().split()
        if len(parts) != 2:
            raise ValueError(f"Invalid price format: {price}")

        amount_str, symbol = parts
        amount = float(amount_str)

        token = cls.get_token(network, symbol)
        amount_smallest = int(amount * (10**token.decimals))

        return {
            "amount": amount_smallest,
            "asset": token.address,
            "decimals": token.decimals,
            "symbol": token.symbol,
            "name": token.name,
            "version": token.version,
        }
