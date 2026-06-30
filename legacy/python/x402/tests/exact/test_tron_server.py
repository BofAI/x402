"""
Tests for ExactTronServerMechanism.
"""

import pytest

from bankofai.x402.mechanisms._exact_base.types import SCHEME_EXACT
from bankofai.x402.mechanisms.tron.exact import ExactTronServerMechanism
from bankofai.x402.tokens import TokenInfo, TokenRegistry
from bankofai.x402.types import PaymentRequirements

USDT_ADDRESS = "TTestUSDTAddress1234567890123456789"


@pytest.fixture(autouse=True)
def _register_test_token():
    TokenRegistry.register_token(
        "tron:nile",
        TokenInfo(address=USDT_ADDRESS, decimals=6, name="Tether USD", symbol="USDT"),
    )
    yield
    TokenRegistry._tokens.get("tron:nile", {}).pop("USDT", None)


@pytest.fixture
def mechanism():
    return ExactTronServerMechanism()


class TestScheme:
    def test_scheme(self, mechanism):
        assert mechanism.scheme() == SCHEME_EXACT


class TestParsePrice:
    @pytest.mark.anyio
    async def test_parse_valid_price(self, mechanism):
        result = await mechanism.parse_price("1 USDT", "tron:nile")
        assert result["amount"] == 1_000_000
        assert result["symbol"] == "USDT"
        assert result["decimals"] == 6

    @pytest.mark.anyio
    async def test_parse_fractional_price(self, mechanism):
        result = await mechanism.parse_price("0.5 USDT", "tron:nile")
        assert result["amount"] == 500_000

    @pytest.mark.anyio
    async def test_parse_invalid_format(self, mechanism):
        with pytest.raises(ValueError):
            await mechanism.parse_price("invalid", "tron:nile")


class TestValidatePaymentRequirements:
    def test_valid_requirements(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="tron:nile",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo="TMerchantAddr12345678901234567890",
        )
        assert mechanism.validate_payment_requirements(req) is True

    def test_invalid_network(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="eip155:1",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo="TMerchantAddr12345678901234567890",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_invalid_asset_format(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="tron:nile",
            amount="1000000",
            asset="0xNotTronAddress",
            payTo="TMerchantAddr12345678901234567890",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_invalid_payto_format(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="tron:nile",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo="0xNotTronAddress",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_zero_amount(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="tron:nile",
            amount="0",
            asset=USDT_ADDRESS,
            payTo="TMerchantAddr12345678901234567890",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_negative_amount(self, mechanism):
        req = PaymentRequirements(
            scheme="exact",
            network="tron:nile",
            amount="-100",
            asset=USDT_ADDRESS,
            payTo="TMerchantAddr12345678901234567890",
        )
        assert mechanism.validate_payment_requirements(req) is False


class TestVerifySignature:
    @pytest.mark.anyio
    async def test_passthrough_when_permit_none(self, mechanism):
        result = await mechanism.verify_signature(None, "0xsig", "tron:nile")
        assert result is True

    @pytest.mark.anyio
    async def test_passthrough_when_permit_present(self, mechanism):
        result = await mechanism.verify_signature(object(), "0xsig", "tron:nile")
        assert result is True
