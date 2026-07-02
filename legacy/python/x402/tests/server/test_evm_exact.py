"""
Tests for ExactPermitEvmServerMechanism - EVM exact payment scheme server.
"""

import pytest

from bankofai.x402.mechanisms.evm.exact_permit import ExactPermitEvmServerMechanism
from bankofai.x402.tokens import TokenInfo, TokenRegistry
from bankofai.x402.types import PaymentRequirements

USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"


@pytest.fixture(autouse=True)
def _register_test_token():
    TokenRegistry.register_token(
        "eip155:8453",
        TokenInfo(address=USDC_ADDRESS, decimals=6, name="USD Coin", symbol="USDC"),
    )
    yield
    TokenRegistry._tokens.get("eip155:8453", {}).pop("USDC", None)


@pytest.fixture
def mechanism():
    return ExactPermitEvmServerMechanism()


class TestScheme:
    def test_scheme(self, mechanism):
        assert mechanism.scheme() == "exact_permit"


class TestParsePrice:
    @pytest.mark.anyio
    async def test_parse_valid_price(self, mechanism):
        result = await mechanism.parse_price("1 USDC", "eip155:8453")
        assert result["amount"] == 1_000_000
        assert result["symbol"] == "USDC"
        assert result["decimals"] == 6

    @pytest.mark.anyio
    async def test_parse_fractional_price(self, mechanism):
        result = await mechanism.parse_price("0.5 USDC", "eip155:8453")
        assert result["amount"] == 500_000

    @pytest.mark.anyio
    async def test_parse_invalid_format(self, mechanism):
        with pytest.raises(ValueError):
            await mechanism.parse_price("invalid", "eip155:8453")


class TestValidatePaymentRequirements:
    def test_valid_requirements(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset=USDC_ADDRESS,
            payTo="0xMerchantAddress000000000000000000000001",
        )
        assert mechanism.validate_payment_requirements(req) is True

    def test_invalid_network(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="tron:nile",
            amount="1000000",
            asset=USDC_ADDRESS,
            payTo="0xMerchantAddress000000000000000000000001",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_invalid_asset_format(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset="TNotEvmAddress",
            payTo="0xMerchantAddress000000000000000000000001",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_invalid_payto_format(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset=USDC_ADDRESS,
            payTo="TNotEvmAddress",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_zero_amount(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="0",
            asset=USDC_ADDRESS,
            payTo="0xMerchantAddress000000000000000000000001",
        )
        assert mechanism.validate_payment_requirements(req) is False

    def test_negative_amount(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="-100",
            asset=USDC_ADDRESS,
            payTo="0xMerchantAddress000000000000000000000001",
        )
        assert mechanism.validate_payment_requirements(req) is False


class TestEnhancePaymentRequirements:
    @pytest.mark.anyio
    async def test_adds_token_metadata(self, mechanism):
        req = PaymentRequirements(
            scheme="exact_permit",
            network="eip155:8453",
            amount="1000000",
            asset=USDC_ADDRESS,
            payTo="0xMerchantAddress000000000000000000000001",
        )
        enhanced = await mechanism.enhance_payment_requirements(req, "PAYMENT_ONLY")
        assert enhanced.extra is not None
        assert enhanced.extra.name == "USD Coin"
        assert enhanced.extra.version == "1"
