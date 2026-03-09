"""
Tests for server-side signature verification
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402_deprecated.server.x402_server import X402Server
from bankofai.x402_deprecated.types import (
    Fee,
    Payment,
    PaymentPayload,
    PaymentPayloadData,
    PaymentPermit,
    PaymentRequirements,
    PermitMeta,
    VerifyResponse,
)


@pytest.fixture
def mock_server():
    """Create X402Server with mocked mechanism"""
    server = X402Server(auto_register_tron=False)
    return server


@pytest.fixture
def sample_permit():
    """Create a sample payment permit"""
    return PaymentPermit(
        meta=PermitMeta(
            kind="PAYMENT_ONLY",
            paymentId="0x12345678901234567890123456789012",
            nonce="123456",
            validAfter=1000000000,
            validBefore=2000000000,
        ),
        buyer="TTestBuyerAddress1111111111111111",
        caller="TTestCallerAddress111111111111111",
        payment=Payment(
            payToken="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
            payAmount="1000000",
            payTo="TTestPayToAddress1111111111111111",
        ),
        fee=Fee(
            feeTo="TTestFeeToAddress1111111111111111",
            feeAmount="10000",
        ),
    )


@pytest.fixture
def sample_requirements():
    """Create sample payment requirements"""
    return PaymentRequirements(
        scheme="exact_permit",
        network="tron:shasta",
        amount="1000000",
        asset="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        payTo="TTestPayToAddress1111111111111111",
        maxTimeoutSeconds=3600,
    )


@pytest.mark.anyio
async def test_verify_payment_with_invalid_signature(
    mock_server, sample_permit, sample_requirements
):
    """Test that server rejects invalid signatures"""
    # Create mock mechanism that returns False for signature verification
    mock_mechanism = MagicMock()
    mock_mechanism.scheme.return_value = "exact_permit"
    mock_mechanism.verify_signature = AsyncMock(return_value=False)

    # Register mock mechanism
    mock_server.register("tron:shasta", mock_mechanism)

    # Create payload with invalid signature
    payload = PaymentPayload(
        x402Version=2,
        payload=PaymentPayloadData(
            paymentPermit=sample_permit,
            signature="0xinvalidsignature",
        ),
        accepted=sample_requirements,
    )

    # Verify payment
    result = await mock_server.verify_payment(payload, sample_requirements)

    # Should fail with invalid_signature_server
    assert result.is_valid is False
    assert result.invalid_reason == "invalid_signature_server"

    # Verify that signature verification was called
    mock_mechanism.verify_signature.assert_called_once()


@pytest.mark.anyio
async def test_verify_payment_with_valid_signature(mock_server, sample_permit, sample_requirements):
    """Test that server accepts valid signatures and delegates to facilitator"""
    # Create mock mechanism that returns True for signature verification
    mock_mechanism = MagicMock()
    mock_mechanism.scheme.return_value = "exact_permit"
    mock_mechanism.verify_signature = AsyncMock(return_value=True)

    # Register mock mechanism
    mock_server.register("tron:shasta", mock_mechanism)

    # Create mock facilitator
    mock_facilitator = MagicMock()
    mock_facilitator.facilitator_id = "test_facilitator"
    mock_facilitator.verify = AsyncMock(return_value=VerifyResponse(isValid=True))
    mock_server.set_facilitator(mock_facilitator)

    # Create payload with valid signature
    payload = PaymentPayload(
        x402Version=2,
        payload=PaymentPayloadData(
            paymentPermit=sample_permit,
            signature="0xvalidsignature",
        ),
        accepted=sample_requirements,
    )

    # Verify payment
    result = await mock_server.verify_payment(payload, sample_requirements)

    # Should succeed
    assert result.is_valid is True

    # Verify that both server and facilitator verification were called
    mock_mechanism.verify_signature.assert_called_once()
    mock_facilitator.verify.assert_called_once()


@pytest.mark.anyio
async def test_verify_payment_without_mechanism(mock_server, sample_permit, sample_requirements):
    """Test that verification continues even without registered mechanism"""
    # Don't register any mechanism

    # Create mock facilitator
    mock_facilitator = MagicMock()
    mock_facilitator.facilitator_id = "test_facilitator"
    mock_facilitator.verify = AsyncMock(return_value=VerifyResponse(isValid=True))
    mock_server.set_facilitator(mock_facilitator)

    # Create payload
    payload = PaymentPayload(
        x402Version=2,
        payload=PaymentPayloadData(
            paymentPermit=sample_permit,
            signature="0xsomesignature",
        ),
        accepted=sample_requirements,
    )

    # Verify payment - should skip server verification and delegate to facilitator
    result = await mock_server.verify_payment(payload, sample_requirements)

    # Should succeed (facilitator returns True)
    assert result.is_valid is True
    mock_facilitator.verify.assert_called_once()


@pytest.mark.anyio
async def test_verify_payment_payload_mismatch(mock_server, sample_permit, sample_requirements):
    """Test that payload mismatch is caught before signature verification"""
    # Create mock mechanism
    mock_mechanism = MagicMock()
    mock_mechanism.scheme.return_value = "exact_permit"
    mock_mechanism.verify_signature = AsyncMock(return_value=True)
    mock_server.register("tron:shasta", mock_mechanism)

    # Modify permit to not match requirements
    mismatched_permit = sample_permit.model_copy(deep=True)
    mismatched_permit.payment.pay_to = "TDifferentAddress111111111111111111"

    payload = PaymentPayload(
        x402Version=2,
        payload=PaymentPayloadData(
            paymentPermit=mismatched_permit,
            signature="0xsomesignature",
        ),
        accepted=sample_requirements,
    )

    # Verify payment
    result = await mock_server.verify_payment(payload, sample_requirements)

    # Should fail with payload_mismatch before signature verification
    assert result.is_valid is False
    assert result.invalid_reason == "payload_mismatch"

    # Signature verification should not be called
    mock_mechanism.verify_signature.assert_not_called()
