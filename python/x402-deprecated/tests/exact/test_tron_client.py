"""
Tests for ExactTronClientMechanism.
"""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402_deprecated.mechanisms._exact_base.types import SCHEME_EXACT
from bankofai.x402_deprecated.mechanisms.tron.exact import ExactTronClientMechanism
from bankofai.x402_deprecated.tokens import TokenInfo, TokenRegistry
from bankofai.x402_deprecated.types import PaymentRequirements

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
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "TBuyerAddress12345678901234567890"
    signer.sign_typed_data = AsyncMock(return_value="0x" + "ab" * 65)
    return signer


@pytest.fixture
def nile_requirements():
    return PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        amount="1000000",
        asset=USDT_ADDRESS,
        payTo="TMerchantAddr12345678901234567890",
    )


class TestScheme:
    def test_scheme_returns_exact(self, mock_signer):
        mechanism = ExactTronClientMechanism(mock_signer)
        assert mechanism.scheme() == SCHEME_EXACT

    def test_get_signer(self, mock_signer):
        mechanism = ExactTronClientMechanism(mock_signer)
        assert mechanism.get_signer() is mock_signer


class TestCreatePaymentPayload:
    @pytest.mark.anyio
    async def test_payload_structure(self, mock_signer, nile_requirements):
        mechanism = ExactTronClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        assert payload.x402_version == 2
        assert payload.resource.url == "https://example.com/resource"
        assert payload.accepted == nile_requirements
        assert payload.payload.signature == "0x" + "ab" * 65
        assert payload.payload.payment_permit is None

    @pytest.mark.anyio
    async def test_extensions_contain_authorization(self, mock_signer, nile_requirements):
        mechanism = ExactTronClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        assert "transferAuthorization" in payload.extensions
        auth = payload.extensions["transferAuthorization"]
        assert "from" in auth
        assert "to" in auth
        assert auth["value"] == "1000000"
        assert "validAfter" in auth
        assert "validBefore" in auth
        assert "nonce" in auth

    @pytest.mark.anyio
    async def test_validity_window(self, mock_signer, nile_requirements):
        mechanism = ExactTronClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        auth = payload.extensions["transferAuthorization"]
        now = int(time.time())
        assert int(auth["validAfter"]) <= now
        assert int(auth["validBefore"]) > now

    @pytest.mark.anyio
    async def test_nonce_is_unique(self, mock_signer, nile_requirements):
        mechanism = ExactTronClientMechanism(mock_signer)
        p1 = await mechanism.create_payment_payload(nile_requirements, "https://a.com")
        p2 = await mechanism.create_payment_payload(nile_requirements, "https://b.com")

        assert (
            p1.extensions["transferAuthorization"]["nonce"]
            != p2.extensions["transferAuthorization"]["nonce"]
        )

    @pytest.mark.anyio
    async def test_sign_typed_data_called(self, mock_signer, nile_requirements):
        mechanism = ExactTronClientMechanism(mock_signer)
        await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        mock_signer.sign_typed_data.assert_called_once()
        call_kwargs = mock_signer.sign_typed_data.call_args.kwargs
        assert "domain" in call_kwargs
        assert "types" in call_kwargs
        assert "message" in call_kwargs

    @pytest.mark.anyio
    async def test_domain_uses_token_contract(self, mock_signer, nile_requirements):
        """verifyingContract should be the EVM-format token address"""
        mechanism = ExactTronClientMechanism(mock_signer)
        await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        call_kwargs = mock_signer.sign_typed_data.call_args.kwargs
        domain = call_kwargs["domain"]
        assert domain["name"] == "Tether USD"
        assert domain["version"] == "1"
        # TRON nile chain ID
        assert domain["chainId"] == 3448148188
        # verifyingContract should be present
        assert "verifyingContract" in domain
