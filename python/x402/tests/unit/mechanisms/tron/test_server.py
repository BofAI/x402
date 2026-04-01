"""Tests for TRON Exact server scheme."""

import pytest

from bankofai.x402.mechanisms.tron import get_network_config
from bankofai.x402.mechanisms.tron.exact import ExactTronServerScheme
from bankofai.x402.schemas import AssetAmount, PaymentRequirements, SupportedKind


def test_parse_price_default_asset():
    server = ExactTronServerScheme()
    network = "tron:nile"
    result = server.parse_price("$0.10", network)
    assert result.amount == "100000"
    assert result.asset == get_network_config(network)["default_asset"]["address"]
    assert result.extra == {"assetTransferMethod": "permit2"}


def test_parse_price_asset_amount():
    server = ExactTronServerScheme()
    network = "tron:nile"
    asset_amount = AssetAmount(amount="123", asset="0x" + "11" * 20, extra={"foo": "bar"})
    result = server.parse_price(asset_amount, network)
    assert result.amount == "123"
    assert result.asset == asset_amount.asset
    assert result.extra == {"foo": "bar"}


def test_parse_price_missing_asset_raises():
    server = ExactTronServerScheme()
    with pytest.raises(ValueError, match="Asset address required"):
        server.parse_price({"amount": "123"}, "tron:nile")


def test_enhance_payment_requirements_adds_domain():
    server = ExactTronServerScheme()
    network = "tron:nile"
    requirements = PaymentRequirements(
        scheme="exact",
        network=network,
        asset="",
        amount="1000",
        pay_to="0x" + "22" * 20,
        max_timeout_seconds=3600,
        extra={},
    )
    supported_kind = SupportedKind(x402_version=2, scheme="exact", network=network, extra={})
    result = server.enhance_payment_requirements(requirements, supported_kind, [])
    assert result.asset == get_network_config(network)["default_asset"]["address"]
    assert result.extra is not None
    assert result.extra.get("assetTransferMethod") == "permit2"
    # name/version not injected for permit2-only assets (no supports_eip2612)
    assert "name" not in result.extra
    assert "version" not in result.extra


def test_enhance_payment_requirements_converts_decimal_amount():
    server = ExactTronServerScheme()
    network = "tron:nile"
    default_asset = get_network_config(network)["default_asset"]
    requirements = PaymentRequirements(
        scheme="exact",
        network=network,
        asset=default_asset["address"],
        amount="0.01",
        pay_to="0x" + "22" * 20,
        max_timeout_seconds=3600,
        extra={},
    )
    supported_kind = SupportedKind(x402_version=2, scheme="exact", network=network, extra={})
    result = server.enhance_payment_requirements(requirements, supported_kind, [])
    assert result.amount == "10000"  # 0.01 * 10^6
