"""
Tests for ExactPermitEvmClientMechanism - EVM exact payment scheme client.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.mechanisms.evm.exact_permit import ExactPermitEvmClientMechanism
from bankofai.x402.types import FeeInfo, PaymentRequirements, PaymentRequirementsExtra


@pytest.fixture
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "0xBuyerAddress0000000000000000000000000001"
    signer.sign_typed_data = AsyncMock(return_value="0x" + "ab" * 65)
    signer.ensure_allowance = AsyncMock(return_value=True)
    return signer


@pytest.fixture
def base_requirements():
    return PaymentRequirements(
        scheme="exact_permit",
        network="eip155:8453",
        amount="1000000",
        asset="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        payTo="0xMerchantAddress000000000000000000000001",
        extra=PaymentRequirementsExtra(
            fee=FeeInfo(
                feeTo="0xFacilitatorAddr0000000000000000000000001",
                feeAmount="10000",
            ),
        ),
    )


@pytest.fixture
def permit_context():
    import time

    return {
        "paymentPermitContext": {
            "meta": {
                "kind": "PAYMENT_ONLY",
                "paymentId": "0x" + "12" * 16,
                "nonce": "1",
                "validAfter": 0,
                "validBefore": int(time.time()) + 3600,
            },
        }
    }


class TestExactEvmClient:
    def test_scheme(self, mock_signer):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)
        assert mechanism.scheme() == "exact_permit"

    def test_get_signer(self, mock_signer):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)
        assert mechanism.get_signer() is mock_signer

    @pytest.mark.anyio
    async def test_ensure_allowance_called(self, mock_signer, base_requirements, permit_context):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)

        await mechanism.create_payment_payload(
            base_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        mock_signer.ensure_allowance.assert_called_once()
        call_args = mock_signer.ensure_allowance.call_args
        assert call_args[0][0] == base_requirements.asset
        assert call_args[0][1] == 1010000  # amount + fee
        assert call_args[0][2] == "eip155:8453"

    @pytest.mark.anyio
    async def test_allowance_amount_includes_fee(
        self, mock_signer, base_requirements, permit_context
    ):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)

        await mechanism.create_payment_payload(
            base_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        call_args = mock_signer.ensure_allowance.call_args
        expected_total = int(base_requirements.amount) + 10000
        assert call_args[0][1] == expected_total

    @pytest.mark.anyio
    async def test_payload_structure(self, mock_signer, base_requirements, permit_context):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)
        payload = await mechanism.create_payment_payload(
            base_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        assert payload.x402_version == 2
        assert payload.payload.signature == "0x" + "ab" * 65
        assert payload.payload.payment_permit is not None
        assert payload.payload.payment_permit.buyer == "0xBuyerAddress0000000000000000000000000001"

    @pytest.mark.anyio
    async def test_sign_typed_data_called(self, mock_signer, base_requirements, permit_context):
        mechanism = ExactPermitEvmClientMechanism(mock_signer)
        await mechanism.create_payment_payload(
            base_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        mock_signer.sign_typed_data.assert_called_once()
        call_kwargs = mock_signer.sign_typed_data.call_args.kwargs
        assert "domain" in call_kwargs
        assert "types" in call_kwargs
        assert "message" in call_kwargs
        assert call_kwargs["domain"]["name"] == "PaymentPermit"
        assert call_kwargs["domain"]["chainId"] == 8453
