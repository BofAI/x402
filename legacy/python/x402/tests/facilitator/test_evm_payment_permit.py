"""
Tests for ExactPermitEvmFacilitatorMechanism - EVM exact payment scheme facilitator.
"""

import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.mechanisms.evm.exact_permit import ExactPermitEvmFacilitatorMechanism
from bankofai.x402.tokens import TokenInfo, TokenRegistry
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
    signer.write_contract = AsyncMock(return_value="0xtxhash_evm_exact")
    signer.wait_for_transaction_receipt = AsyncMock(
        return_value={
            "hash": "0xtxhash_evm_exact",
            "blockNumber": "12345",
            "status": "confirmed",
        }
    )
    return signer


@pytest.fixture
def base_requirements():
    return PaymentRequirements(
        scheme="exact_permit",
        network="eip155:8453",
        amount="1000000",
        asset=USDC_ADDRESS,
        payTo="0xMerchantAddress000000000000000000000001",
    )


@pytest.fixture
def valid_payload(base_requirements):
    now = int(time.time())
    return PaymentPayload(
        x402Version=2,
        resource=ResourceInfo(url="https://api.example.com/resource"),
        accepted=base_requirements,
        payload=PaymentPayloadData(
            signature="0x" + "ab" * 65,
            paymentPermit=PaymentPermit(
                meta=PermitMeta(
                    kind="PAYMENT_ONLY",
                    paymentId="0x" + "12" * 16,
                    nonce="1",
                    validAfter=0,
                    validBefore=now + 3600,
                ),
                buyer="0xBuyerAddress0000000000000000000000000001",
                caller="0xFacilitatorAddr0000000000000000000000001",
                payment=Payment(
                    payToken=USDC_ADDRESS,
                    payAmount="1000000",
                    payTo="0xMerchantAddress000000000000000000000001",
                ),
                fee=Fee(
                    feeTo="0xFacilitatorAddr0000000000000000000000001",
                    feeAmount="1000000",
                ),
            ),
        ),
    )


class TestScheme:
    def test_scheme(self, mock_signer):
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 0})
        assert mechanism.scheme() == "exact_permit"


class TestFeeQuote:
    @pytest.mark.anyio
    async def test_fee_quote(self, mock_signer, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 5000})
        result = await mechanism.fee_quote(base_requirements)
        assert result is not None
        assert result.fee.fee_amount == "5000"
        assert result.scheme == "exact_permit"
        assert result.network == "eip155:8453"

    @pytest.mark.anyio
    async def test_fee_quote_unsupported_token(self, mock_signer, base_requirements):
        """Token in base_fee doesn't match the asset in requirements → returns None"""
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDT": 0})
        result = await mechanism.fee_quote(base_requirements)
        assert result is None


class TestTokenWhitelist:
    @pytest.mark.anyio
    async def test_allowed_token_passes(self, mock_signer, valid_payload, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(
            mock_signer,
            allowed_tokens={USDC_ADDRESS},
            base_fee={"USDC": 0},
        )
        result = await mechanism.verify(valid_payload, base_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_disallowed_token_rejected(self, mock_signer, valid_payload, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"0xSomeOtherToken000000000000000000000001"},
            base_fee={"USDC": 0},
        )
        result = await mechanism.verify(valid_payload, base_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"

    @pytest.mark.anyio
    async def test_none_whitelist_allows_all(self, mock_signer, valid_payload, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(
            mock_signer,
            allowed_tokens=None,
            base_fee={"USDC": 0},
        )
        result = await mechanism.verify(valid_payload, base_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_empty_whitelist_rejects_all(self, mock_signer, valid_payload, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(
            mock_signer,
            allowed_tokens=set(),
            base_fee={"USDC": 0},
        )
        result = await mechanism.verify(valid_payload, base_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"


class TestSettle:
    @pytest.mark.anyio
    async def test_settle_success(self, mock_signer, valid_payload, base_requirements):
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 0})
        result = await mechanism.settle(valid_payload, base_requirements)

        assert result.success is True
        assert result.transaction == "0xtxhash_evm_exact"
        assert result.network == "eip155:8453"
        mock_signer.write_contract.assert_called_once()

    @pytest.mark.anyio
    async def test_settle_calls_permit_transfer_from(
        self, mock_signer, valid_payload, base_requirements
    ):
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 0})
        await mechanism.settle(valid_payload, base_requirements)

        call_args = mock_signer.write_contract.call_args
        assert call_args.kwargs["method"] == "permitTransferFrom"

    @pytest.mark.anyio
    async def test_settle_transaction_failed(self, mock_signer, valid_payload, base_requirements):
        mock_signer.write_contract = AsyncMock(return_value=None)
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 0})
        result = await mechanism.settle(valid_payload, base_requirements)

        assert result.success is False
        assert result.error_reason == "transaction_failed"

    @pytest.mark.anyio
    async def test_settle_fee_amount_mismatch(self, mock_signer, valid_payload, base_requirements):
        valid_payload.payload.payment_permit.fee.fee_amount = "0"
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 1_000_000})
        result = await mechanism.settle(valid_payload, base_requirements)

        assert result.success is False
        assert result.error_reason == "fee_amount_mismatch"

    @pytest.mark.anyio
    async def test_settle_fee_to_mismatch(self, mock_signer, valid_payload, base_requirements):
        valid_payload.payload.payment_permit.fee.fee_to = "0xWrongAddress"
        mechanism = ExactPermitEvmFacilitatorMechanism(mock_signer, base_fee={"USDC": 0})
        result = await mechanism.settle(valid_payload, base_requirements)

        assert result.success is False
        assert result.error_reason == "fee_to_mismatch"

    @pytest.mark.anyio
    async def test_settle_rejects_disallowed_token(
        self, mock_signer, valid_payload, base_requirements
    ):
        mechanism = ExactPermitEvmFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"0xSomeOtherToken000000000000000000000001"},
            base_fee={"USDC": 0},
        )
        result = await mechanism.settle(valid_payload, base_requirements)

        assert result.success is False
        assert result.error_reason == "token_not_allowed"
        mock_signer.write_contract.assert_not_called()
