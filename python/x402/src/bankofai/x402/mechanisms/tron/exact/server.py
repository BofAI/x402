"""TRON server scheme for ExactTronScheme (v2 Python SDK).

Parses prices and enhances payment requirements with TIP-712 domain info.
"""

from collections.abc import Callable
from typing import Any

from ....schemas import AssetAmount, Network, PaymentRequirements, Price, SupportedKind
from ..constants import SCHEME_EXACT, TRON_DEFAULT_ASSETS


class ExactTronServerScheme:
    """TRON server implementation for the Exact payment scheme.

    Handles price parsing (USD/Money → TRC-20 atomic amount) and
    enhances payment requirements with TIP-712 domain parameters.

    Attributes:
        scheme: Always "exact".
    """

    scheme = SCHEME_EXACT

    def __init__(self) -> None:
        """Create ExactTronServerScheme."""
        self._money_parsers: list[Callable[[float, str], AssetAmount | None]] = []

    def register_money_parser(
        self, parser: Callable[[float, str], AssetAmount | None]
    ) -> "ExactTronServerScheme":
        """Register a custom money parser.

        Args:
            parser: Callable(decimal_amount, network_str) → AssetAmount | None.

        Returns:
            Self for chaining.
        """
        self._money_parsers.append(parser)
        return self

    def parse_price(self, price: Price, network: Network) -> AssetAmount:
        """Parse a price into an asset amount.

        Args:
            price: Price to parse (USD string, number, or AssetAmount dict).
            network: TRON network identifier.

        Returns:
            AssetAmount with amount, asset, and optional extra fields.
        """
        # Already an AssetAmount dict
        if isinstance(price, dict) and "amount" in price:
            if not price.get("asset"):
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return AssetAmount(
                amount=str(price["amount"]),
                asset=price["asset"],
                extra=price.get("extra", {}),
            )

        if isinstance(price, AssetAmount):
            if not price.asset:
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return price

        # Parse Money to decimal
        decimal_amount = self._parse_money_to_decimal(price)

        # Try custom parsers
        for parser in self._money_parsers:
            result = parser(decimal_amount, str(network))
            if result is not None:
                return result

        # Default: USDT on this network
        return self._default_money_conversion(decimal_amount, str(network))

    def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        supported_kind: SupportedKind,
        extension_keys: list[str],
    ) -> PaymentRequirements:
        """Add TIP-712 domain parameters and default asset to requirements.

        Args:
            requirements: Base payment requirements.
            supported_kind: Supported kind from facilitator.
            extension_keys: Extension keys (unused).

        Returns:
            Enhanced payment requirements.
        """
        network_str = str(requirements.network)
        asset_info = TRON_DEFAULT_ASSETS.get(network_str)

        # Default asset
        if not requirements.asset and asset_info:
            requirements.asset = asset_info["address"]

        # Convert decimal amount to atomic units if needed
        if asset_info and "." in requirements.amount:
            decimals = asset_info["decimals"]
            requirements.amount = str(int(float(requirements.amount) * (10**decimals)))

        # Add TIP-712 domain params
        if requirements.extra is None:
            requirements.extra = {}
        if asset_info:
            if "name" not in requirements.extra:
                requirements.extra["name"] = asset_info["name"]
            if "version" not in requirements.extra:
                requirements.extra["version"] = asset_info["version"]

        facilitator_extra = supported_kind.extra or {}
        if (
            "assetTransferMethod" not in requirements.extra
            and facilitator_extra.get("supportedAssetTransferMethods")
        ):
            supported_methods = facilitator_extra["supportedAssetTransferMethods"]
            if "permit2" in supported_methods:
                requirements.extra["assetTransferMethod"] = "permit2"
            elif "eip3009" in supported_methods:
                requirements.extra["assetTransferMethod"] = "eip3009"

        if (
            requirements.extra.get("assetTransferMethod") == "permit2"
            and "permit2FacilitatorAddress" not in requirements.extra
            and facilitator_extra.get("permit2FacilitatorAddress")
        ):
            requirements.extra["permit2FacilitatorAddress"] = facilitator_extra[
                "permit2FacilitatorAddress"
            ]

        return requirements

    def _parse_money_to_decimal(self, money: Any) -> float:
        """Parse USD string ('$1.50', '1.50') or number to decimal float."""
        if isinstance(money, (int, float)):
            return float(money)
        clean = str(money).lstrip("$").strip()
        try:
            return float(clean)
        except ValueError:
            raise ValueError(f"Invalid money format: {money}") from None

    def _default_money_conversion(self, amount: float, network: str) -> AssetAmount:
        """Convert decimal USD amount to USDT AssetAmount on this network."""
        asset_info = TRON_DEFAULT_ASSETS.get(network)
        if not asset_info:
            raise ValueError(f"No default asset configured for TRON network {network}")
        token_amount = int(amount * (10 ** asset_info["decimals"]))
        return AssetAmount(
            amount=str(token_amount),
            asset=asset_info["address"],
            extra={"name": asset_info["name"], "version": asset_info["version"]},
        )
