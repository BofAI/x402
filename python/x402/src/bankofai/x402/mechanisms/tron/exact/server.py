"""TRON server implementation for the Exact payment scheme (V2)."""

import re
from collections.abc import Callable

from ....schemas import AssetAmount, Network, PaymentRequirements, Price, SupportedKind
from ..constants import SCHEME_EXACT
from ..utils import get_asset_info, get_network_config

MoneyParser = Callable[[float, str], AssetAmount | None]


class ExactTronServerScheme:
    """TRON server implementation for the Exact payment scheme (V2)."""

    scheme = SCHEME_EXACT

    def __init__(self):
        self._money_parsers: list[MoneyParser] = []

    def register_money_parser(self, parser: MoneyParser) -> "ExactTronServerScheme":
        self._money_parsers.append(parser)
        return self

    def parse_price(self, price: Price, network: Network) -> AssetAmount:
        if isinstance(price, dict) and "amount" in price:
            if not price.get("asset"):
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return AssetAmount(
                amount=price["amount"],
                asset=price["asset"],
                extra=price.get("extra", {}),
            )

        if isinstance(price, AssetAmount):
            if not price.asset:
                raise ValueError(f"Asset address required for AssetAmount on {network}")
            return price

        decimal_amount = _parse_money_to_decimal(price)
        for parser in self._money_parsers:
            result = parser(decimal_amount, str(network))
            if result is not None:
                return result

        return self._default_money_conversion(decimal_amount, str(network))

    def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        supported_kind: SupportedKind,
        extension_keys: list[str],
    ) -> PaymentRequirements:
        config = get_network_config(str(requirements.network))

        if not requirements.asset:
            default = config.get("default_asset")
            if not default or not default.get("address"):
                raise ValueError(
                    f"No default stablecoin configured for network {requirements.network}"
                )
            requirements.asset = default["address"]

        try:
            asset_info = get_asset_info(str(requirements.network), requirements.asset)
        except ValueError:
            asset_info = None

        if requirements.extra is None:
            requirements.extra = {}

        # Merge facilitator extra (e.g. permit2FacilitatorAddress) from supported kind
        kind_extra = supported_kind.extra or {}
        for key, value in kind_extra.items():
            if key not in requirements.extra:
                requirements.extra[key] = value

        if asset_info is not None:
            if "name" not in requirements.extra:
                requirements.extra["name"] = asset_info["name"]
            if "version" not in requirements.extra:
                requirements.extra["version"] = asset_info["version"]
            atm = asset_info.get("asset_transfer_method")
            if "assetTransferMethod" not in requirements.extra and atm:
                requirements.extra["assetTransferMethod"] = atm

        return requirements

    def _default_money_conversion(self, amount: float, network: str) -> AssetAmount:
        config = get_network_config(network)
        asset = config.get("default_asset")
        if not asset or not asset.get("address"):
            raise ValueError(f"No default stablecoin configured for network {network}")

        token_amount = int(amount * (10 ** asset["decimals"]))
        extra: dict = {"name": asset["name"], "version": asset["version"]}
        atm = asset.get("asset_transfer_method")
        if atm:
            extra["assetTransferMethod"] = atm

        return AssetAmount(amount=str(token_amount), asset=asset["address"], extra=extra)


def _parse_money_to_decimal(money: str | float | int) -> float:
    if isinstance(money, int | float):
        return float(money)

    clean = str(money).strip()
    clean = clean.lstrip("$")
    clean = re.sub(r"\s*(USD|USDT|usd|usdt)\s*$", "", clean)
    clean = clean.strip()
    return float(clean)
