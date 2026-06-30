"""
Tests for ExactGasFreeFacilitatorMechanism with standard TRON addresses.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bankofai.x402.abi import GASFREE_PRIMARY_TYPE
from bankofai.x402.mechanisms.tron.exact_gasfree.facilitator import (
    ExactGasFreeFacilitatorMechanism,
)
from bankofai.x402.types import (
    Fee,
    Payment,
    PaymentPayload,
    PaymentPayloadData,
    PaymentPermit,
    PaymentRequirements,
    PermitMeta,
    ResourceInfo,
)

# Standard TRON mock addresses (Base58)
BUYER_ADDR = "TMVQGm1qAQYVdetCeGRRkTWYYrLXuHK2HC"
MERCHANT_ADDR = "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E"
FACILITATOR_ADDR = "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"
USDT_ADDR = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"


@pytest.fixture
def mock_facilitator_signer():
    signer = MagicMock()
    signer.get_address.return_value = FACILITATOR_ADDR
    signer.verify_typed_data = AsyncMock(return_value=True)
    signer.wait_for_transaction_receipt = AsyncMock(
        return_value={"status": "1", "transactionHash": "0xabc"}
    )
    signer.check_balance = AsyncMock(return_value=50000000)
    return signer


@pytest.fixture
def mock_api():
    mock = MagicMock()
    mock.get_providers = AsyncMock(return_value=[{"address": FACILITATOR_ADDR}])
    mock.submit = AsyncMock(return_value="trace-id-123")
    mock.wait_for_success = AsyncMock(return_value={"state": "SUCCEED", "txnHash": "0xhash123"})
    return mock


@pytest.fixture
def gasfree_requirements():
    return PaymentRequirements(
        scheme="exact_gasfree",
        network="tron:nile",
        amount="1000000",
        asset=USDT_ADDR,
        payTo=MERCHANT_ADDR,
        maxTimeoutSeconds=3600,
    )


@pytest.fixture
def gasfree_payload(gasfree_requirements):
    permit = PaymentPermit(
        buyer=BUYER_ADDR,
        caller=FACILITATOR_ADDR,
        meta=PermitMeta(
            kind="PAYMENT_ONLY",
            paymentId="pay-123",
            nonce="1",
            validAfter=0,
            validBefore=2000000000,
        ),
        payment=Payment(
            payToken=USDT_ADDR,
            payAmount="1000000",
            payTo=MERCHANT_ADDR,
        ),
        fee=Fee(
            feeTo=FACILITATOR_ADDR,
            feeAmount="1000000",
        ),
    )
    return PaymentPayload(
        x402Version=2,
        resource=ResourceInfo(url="https://example.com", mimeType="application/json"),
        accepted=gasfree_requirements,
        payload=PaymentPayloadData(
            signature="0x" + "ab" * 65,
            merchantSignature=None,
            paymentPermit=permit,
        ),
        extensions={"gasfreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"},
    )


class TestGasFreeFacilitator:
    @pytest.mark.anyio
    async def test_verify_calls_signer_with_correct_data(
        self, mock_facilitator_signer, gasfree_requirements, gasfree_payload, mock_api
    ):
        mechanism = ExactGasFreeFacilitatorMechanism(
            mock_facilitator_signer, clients={"tron:nile": mock_api}, base_fee={"USDT": 1000000}
        )

        with patch("bankofai.x402.tokens.TokenRegistry.find_by_address") as mock_find:
            mock_find.return_value = MagicMock(symbol="USDT")
            result = await mechanism.verify(gasfree_payload, gasfree_requirements)

        assert result.is_valid is True

        # Verify that signer.verify_typed_data was called with converted EVM addresses
        call_args = mock_facilitator_signer.verify_typed_data.call_args
        domain = call_args.kwargs["domain"]
        message = call_args.kwargs["message"]

        assert domain["name"] == "GasFreeController"
        assert domain["verifyingContract"].startswith("0x")
        assert message["token"].startswith("0x")
        assert message["user"].startswith("0x")
        assert message["receiver"].startswith("0x")
        assert message["value"] == 1000000
        assert call_args.kwargs["primary_type"] == GASFREE_PRIMARY_TYPE

    @pytest.mark.anyio
    async def test_settle_submits_to_api(
        self, mock_facilitator_signer, gasfree_requirements, gasfree_payload, mock_api
    ):
        mechanism = ExactGasFreeFacilitatorMechanism(
            mock_facilitator_signer, clients={"tron:nile": mock_api}, base_fee={"USDT": 1000000}
        )

        with patch("bankofai.x402.tokens.TokenRegistry.find_by_address") as mock_find:
            mock_find.return_value = MagicMock(symbol="USDT")
            result = await mechanism.settle(gasfree_payload, gasfree_requirements)

        assert result.success is True
        assert result.transaction == "0xhash123"
        mock_api.submit.assert_called_once()

    @pytest.mark.anyio
    async def test_verify_fail_on_amount_mismatch(
        self, mock_facilitator_signer, gasfree_requirements, gasfree_payload, mock_api
    ):
        mechanism = ExactGasFreeFacilitatorMechanism(
            mock_facilitator_signer, clients={"tron:nile": mock_api}, base_fee={"USDT": 1000000}
        )

        # Client signed for 0.5 USDT, but server requirements is 1 USDT
        gasfree_payload.payload.payment_permit.payment.pay_amount = "500000"

        with patch("bankofai.x402.tokens.TokenRegistry.find_by_address") as mock_find:
            mock_find.return_value = MagicMock(symbol="USDT")
            result = await mechanism.verify(gasfree_payload, gasfree_requirements)

        assert result.is_valid is False
        assert result.invalid_reason == "amount_mismatch"

    @pytest.mark.anyio
    async def test_verify_fail_bad_signature(
        self, mock_facilitator_signer, gasfree_requirements, gasfree_payload, mock_api
    ):
        mock_facilitator_signer.verify_typed_data.return_value = False
        mechanism = ExactGasFreeFacilitatorMechanism(
            mock_facilitator_signer, clients={"tron:nile": mock_api}, base_fee={"USDT": 1000000}
        )

        with patch("bankofai.x402.tokens.TokenRegistry.find_by_address") as mock_find:
            mock_find.return_value = MagicMock(symbol="USDT")
            result = await mechanism.verify(gasfree_payload, gasfree_requirements)

        assert result.is_valid is False
        assert result.invalid_reason == "invalid_signature"
