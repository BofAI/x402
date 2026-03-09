"""
Tests for ExactEvmFacilitatorMechanism.
"""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402_deprecated.mechanisms._exact_base.types import SCHEME_EXACT
from bankofai.x402_deprecated.mechanisms.evm.exact import ExactEvmFacilitatorMechanism
from bankofai.x402_deprecated.tokens import TokenInfo, TokenRegistry
from bankofai.x402_deprecated.types import (
    PaymentPayload,
    PaymentPayloadData,
    PaymentRequirements,
    ResourceInfo,
)

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
    signer.get_address.return_value = "0xFacilitatorAddr0000000000000000000000001"
    signer.verify_typed_data = AsyncMock(return_value=True)
    signer.write_contract = AsyncMock(return_value="txhash_exact")
    signer.wait_for_transaction_receipt = AsyncMock(
        return_value={"hash": "txhash_exact", "status": "confirmed"}
    )
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


def _make_payload(
    requirements,
    nonce=None,
    valid_after=None,
    valid_before=None,
    from_addr="0xBuyerAddress0000000000000000000000000001",
    to_addr=None,
    value=None,
):
    now = int(time.time())
    return PaymentPayload(
        x402Version=2,
        resource=ResourceInfo(url="https://example.com/resource"),
        accepted=requirements,
        payload=PaymentPayloadData(
            signature="0x" + "ab" * 65,
        ),
        extensions={
            "transferAuthorization": {
                "from": from_addr,
                "to": to_addr or requirements.pay_to,
                "value": value or requirements.amount,
                "validAfter": str(valid_after if valid_after is not None else now - 30),
                "validBefore": str(valid_before if valid_before is not None else now + 3600),
                "nonce": nonce or ("0x" + "cd" * 32),
            }
        },
    )


class TestScheme:
    def test_scheme(self, mock_signer):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        assert mechanism.scheme() == SCHEME_EXACT


class TestFeeQuote:
    @pytest.mark.anyio
    async def test_fee_quote_returns_zero(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        result = await mechanism.fee_quote(nile_requirements)
        assert result is not None
        assert result.fee.fee_amount == "0"

    @pytest.mark.anyio
    async def test_fee_quote_fields(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        result = await mechanism.fee_quote(nile_requirements)
        assert result.scheme == "exact"
        assert result.network == "eip155:8453"
        assert result.asset == USDC_ADDRESS


class TestVerify:
    @pytest.mark.anyio
    async def test_valid_payload(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_missing_authorization(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = PaymentPayload(
            x402Version=2,
            resource=ResourceInfo(url="https://example.com"),
            accepted=nile_requirements,
            payload=PaymentPayloadData(signature="0x" + "ab" * 65),
            extensions={},
        )
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "missing_transfer_authorization"

    @pytest.mark.anyio
    async def test_amount_mismatch(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements, value="100")  # less than required 1000000
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "amount_mismatch"

    @pytest.mark.anyio
    async def test_payto_mismatch(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements, to_addr="0xWrongAddress")
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "payto_mismatch"

    @pytest.mark.anyio
    async def test_expired(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements, valid_before=1000)  # past
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "expired"

    @pytest.mark.anyio
    async def test_not_yet_valid(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        future = int(time.time()) + 9999
        payload = _make_payload(nile_requirements, valid_after=future)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "not_yet_valid"

    @pytest.mark.anyio
    async def test_invalid_signature(self, mock_signer, nile_requirements):
        mock_signer.verify_typed_data = AsyncMock(return_value=False)
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "invalid_signature"


class TestTokenWhitelist:
    @pytest.mark.anyio
    async def test_allowed_token_passes(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer, allowed_tokens={USDC_ADDRESS})
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_disallowed_token_rejected(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(
            mock_signer, allowed_tokens={"0xSomeOtherToken000000000000000000000001"}
        )
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"

    @pytest.mark.anyio
    async def test_none_whitelist_allows_all(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer, allowed_tokens=None)
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_empty_whitelist_rejects_all(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer, allowed_tokens=set())
        payload = _make_payload(nile_requirements)
        result = await mechanism.verify(payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"


class TestSettle:
    @pytest.mark.anyio
    async def test_settle_success(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        result = await mechanism.settle(payload, nile_requirements)

        assert result.success is True
        assert result.transaction == "txhash_exact"
        assert result.network == "eip155:8453"

    @pytest.mark.anyio
    async def test_settle_calls_transfer_with_authorization(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        await mechanism.settle(payload, nile_requirements)

        mock_signer.write_contract.assert_called_once()
        call_kwargs = mock_signer.write_contract.call_args.kwargs
        assert call_kwargs["method"] == "transferWithAuthorization"
        assert call_kwargs["contract_address"] == USDC_ADDRESS

    @pytest.mark.anyio
    async def test_settle_transaction_failed(self, mock_signer, nile_requirements):
        mock_signer.write_contract = AsyncMock(return_value=None)
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        result = await mechanism.settle(payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "transaction_failed"

    @pytest.mark.anyio
    async def test_settle_on_chain_failure(self, mock_signer, nile_requirements):
        mock_signer.wait_for_transaction_receipt = AsyncMock(return_value={"status": "failed"})
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements)
        result = await mechanism.settle(payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "transaction_failed_on_chain"

    @pytest.mark.anyio
    async def test_settle_rejects_invalid_payload(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(mock_signer)
        payload = _make_payload(nile_requirements, value="100")  # amount too low
        result = await mechanism.settle(payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "amount_mismatch"
        mock_signer.write_contract.assert_not_called()

    @pytest.mark.anyio
    async def test_settle_rejects_disallowed_token(self, mock_signer, nile_requirements):
        mechanism = ExactEvmFacilitatorMechanism(
            mock_signer, allowed_tokens={"0xSomeOtherToken000000000000000000000001"}
        )
        payload = _make_payload(nile_requirements)
        result = await mechanism.settle(payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "token_not_allowed"
        mock_signer.write_contract.assert_not_called()
