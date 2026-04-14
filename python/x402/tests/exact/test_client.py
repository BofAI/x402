"""
Tests for ExactEvmClientMechanism.
"""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.mechanisms._exact_base.types import SCHEME_EXACT
from bankofai.x402.mechanisms.evm.exact import ExactEvmClientMechanism
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
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "0xBuyerAddress0000000000000000000000000001"
    signer.sign_typed_data = AsyncMock(return_value="0x" + "ab" * 65)
    return signer


@pytest.fixture
def nile_requirements():
    return PaymentRequirements(
        scheme="exact",
        network="eip155:8453",
        amount="1000000",
        asset=USDC_ADDRESS,
        payTo="0xMerchantAddress000000000000000000000001",
    )


class TestScheme:
    def test_scheme_returns_exact(self, mock_signer):
        mechanism = ExactEvmClientMechanism(mock_signer)
        assert mechanism.scheme() == SCHEME_EXACT

    def test_get_signer(self, mock_signer):
        mechanism = ExactEvmClientMechanism(mock_signer)
        assert mechanism.get_signer() is mock_signer


class TestCreatePaymentPayload:
    @pytest.mark.anyio
    async def test_payload_structure(self, mock_signer, nile_requirements):
        mechanism = ExactEvmClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        assert payload.x402_version == 2
        assert payload.resource.url == "https://example.com/resource"
        assert payload.accepted == nile_requirements
        assert payload.payload.signature == "0x" + "ab" * 65
        assert payload.payload.payment_permit is None
        assert payload.payload.authorization is not None

    @pytest.mark.anyio
    async def test_payload_contains_authorization(self, mock_signer, nile_requirements):
        mechanism = ExactEvmClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        auth = payload.payload.authorization
        assert auth is not None
        assert auth.from_address == "0xBuyerAddress0000000000000000000000000001"
        assert auth.to == "0xMerchantAddress000000000000000000000001"
        assert auth.value == "1000000"
        assert auth.valid_after is not None
        assert auth.valid_before is not None
        assert auth.nonce is not None

    @pytest.mark.anyio
    async def test_validity_window(self, mock_signer, nile_requirements):
        mechanism = ExactEvmClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        auth = payload.payload.authorization.model_dump(by_alias=True)
        now = int(time.time())
        assert int(auth["validAfter"]) <= now
        assert int(auth["validBefore"]) > now

    @pytest.mark.anyio
    async def test_nonce_is_unique(self, mock_signer, nile_requirements):
        mechanism = ExactEvmClientMechanism(mock_signer)
        p1 = await mechanism.create_payment_payload(nile_requirements, "https://a.com")
        p2 = await mechanism.create_payment_payload(nile_requirements, "https://b.com")

        assert (
            p1.payload.authorization.nonce
            != p2.payload.authorization.nonce
        )

    @pytest.mark.anyio
    async def test_sign_typed_data_called(self, mock_signer, nile_requirements):
        mechanism = ExactEvmClientMechanism(mock_signer)
        await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        mock_signer.sign_typed_data.assert_called_once()
        call_kwargs = mock_signer.sign_typed_data.call_args.kwargs
        assert "domain" in call_kwargs
        assert "types" in call_kwargs
        assert "message" in call_kwargs

    @pytest.mark.anyio
    async def test_domain_uses_token_contract(self, mock_signer, nile_requirements):
        """verifyingContract should be the token address, not PaymentPermit"""
        mechanism = ExactEvmClientMechanism(mock_signer)
        await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        call_kwargs = mock_signer.sign_typed_data.call_args.kwargs
        domain = call_kwargs["domain"]
        assert domain["name"] == "USD Coin"
        assert domain["version"] == "1"
        assert domain["verifyingContract"] == USDC_ADDRESS
        assert domain["chainId"] == 8453

    @pytest.mark.anyio
    async def test_no_allowance_check(self, mock_signer, nile_requirements):
        """exact should NOT call check_allowance or ensure_allowance"""
        mechanism = ExactEvmClientMechanism(mock_signer)
        await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        assert not hasattr(mock_signer, "check_allowance") or not mock_signer.check_allowance.called
        assert (
            not hasattr(mock_signer, "ensure_allowance") or not mock_signer.ensure_allowance.called
        )
