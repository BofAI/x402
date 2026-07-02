import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.mechanisms.tron.exact_permit import ExactPermitTronFacilitatorMechanism
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


@pytest.fixture(autouse=True)
def _register_test_token():
    """Register fake test token so _get_base_fee can resolve it."""
    TokenRegistry.register_token(
        "tron:nile",
        TokenInfo(address="TTestUSDTAddress", decimals=6, name="Test USDT", symbol="USDT"),
    )
    yield
    # cleanup: remove the test token
    TokenRegistry._tokens.get("tron:nile", {}).pop("USDT", None)


@pytest.fixture
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "TTestFacilitator"
    signer.verify_typed_data = AsyncMock(return_value=True)
    signer.write_contract = AsyncMock(return_value="txhash123456")
    signer.wait_for_transaction_receipt = AsyncMock(
        return_value={"hash": "txhash123456", "blockNumber": "12345", "status": "confirmed"}
    )
    return signer


@pytest.fixture
def nile_requirements():
    return PaymentRequirements(
        scheme="exact_permit",
        network="tron:nile",
        amount="1000000",
        asset="TTestUSDTAddress",
        payTo="TTestMerchantAddress",
    )


@pytest.fixture
def valid_payload(nile_requirements):
    now = int(time.time())
    return PaymentPayload(
        x402Version=2,
        resource=ResourceInfo(url="https://api.example.com/resource"),
        accepted=nile_requirements,
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
                buyer="TTestBuyerAddress",
                caller="TTestFacilitator",
                payment=Payment(
                    payToken="TTestUSDTAddress",
                    payAmount="1000000",
                    payTo="TTestMerchantAddress",
                ),
                fee=Fee(feeTo="TTestFacilitator", feeAmount="1000000"),
            ),
        ),
    )


class TestTokenWhitelist:
    """Token whitelist validation tests"""

    @pytest.mark.anyio
    async def test_allowed_token_passes(self, mock_signer, valid_payload, nile_requirements):
        """Whitelisted token should pass validation"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"TTestUSDTAddress"},
            base_fee={"USDT": 0},
        )
        result = await mechanism.verify(valid_payload, nile_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_disallowed_token_rejected(self, mock_signer, valid_payload, nile_requirements):
        """Non-whitelisted token should be rejected"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"TSomeOtherToken"},
            base_fee={"USDT": 0},
        )
        result = await mechanism.verify(valid_payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"

    @pytest.mark.anyio
    async def test_none_whitelist_allows_all(self, mock_signer, valid_payload, nile_requirements):
        """None whitelist (default) should allow any token"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens=None,
            base_fee={"USDT": 0},
        )
        result = await mechanism.verify(valid_payload, nile_requirements)
        assert result.is_valid is True

    @pytest.mark.anyio
    async def test_empty_whitelist_rejects_all(self, mock_signer, valid_payload, nile_requirements):
        """Empty whitelist should reject all tokens"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens=set(),
            base_fee={"USDT": 0},
        )
        result = await mechanism.verify(valid_payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"

    @pytest.mark.anyio
    async def test_case_sensitive_match(self, mock_signer, valid_payload, nile_requirements):
        """Token whitelist matching should be case-sensitive (TRON Base58)"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"ttestusdtaddress"},
            base_fee={"USDT": 0},
        )
        result = await mechanism.verify(valid_payload, nile_requirements)
        assert result.is_valid is False
        assert result.invalid_reason == "token_not_allowed"

    @pytest.mark.anyio
    async def test_settle_rejects_disallowed_token(
        self, mock_signer, valid_payload, nile_requirements
    ):
        """Settle should also reject non-whitelisted tokens"""
        mechanism = ExactPermitTronFacilitatorMechanism(
            mock_signer,
            allowed_tokens={"TSomeOtherToken"},
            base_fee={"USDT": 0},
        )
        result = await mechanism.settle(valid_payload, nile_requirements)
        assert result.success is False
        assert result.error_reason == "token_not_allowed"
        mock_signer.write_contract.assert_not_called()


class TestFacilitatorSettle:
    """Facilitator settle 执行测试"""

    @pytest.mark.anyio
    async def test_settle_success(self, mock_signer, valid_payload, nile_requirements):
        """测试成功结算"""
        mechanism = ExactPermitTronFacilitatorMechanism(mock_signer, base_fee={"USDT": 0})

        result = await mechanism.settle(valid_payload, nile_requirements)

        assert result.success is True
        assert result.transaction == "txhash123456"
        assert result.network == "tron:nile"
        mock_signer.write_contract.assert_called_once()

    @pytest.mark.anyio
    async def test_settle_calls_permit_transfer_from(
        self, mock_signer, valid_payload, nile_requirements
    ):
        """测试 settle 调用 permitTransferFrom 方法"""
        mechanism = ExactPermitTronFacilitatorMechanism(mock_signer, base_fee={"USDT": 0})

        await mechanism.settle(valid_payload, nile_requirements)

        call_args = mock_signer.write_contract.call_args
        assert call_args.kwargs["method"] == "permitTransferFrom"

    @pytest.mark.anyio
    async def test_settle_transaction_failed(self, mock_signer, valid_payload, nile_requirements):
        """测试交易失败"""
        mock_signer.write_contract = AsyncMock(return_value=None)
        mechanism = ExactPermitTronFacilitatorMechanism(mock_signer, base_fee={"USDT": 0})

        result = await mechanism.settle(valid_payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "transaction_failed"

    @pytest.mark.anyio
    async def test_settle_fee_amount_mismatch(self, mock_signer, valid_payload, nile_requirements):
        valid_payload.payload.payment_permit.fee.fee_amount = "0"
        mechanism = ExactPermitTronFacilitatorMechanism(mock_signer, base_fee={"USDT": 1_000_000})

        result = await mechanism.settle(valid_payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "fee_amount_mismatch"

    @pytest.mark.anyio
    async def test_settle_fee_to_mismatch(self, mock_signer, valid_payload, nile_requirements):
        valid_payload.payload.payment_permit.fee.fee_to = "TWrongAddress"
        mechanism = ExactPermitTronFacilitatorMechanism(mock_signer, base_fee={"USDT": 0})

        result = await mechanism.settle(valid_payload, nile_requirements)

        assert result.success is False
        assert result.error_reason == "fee_to_mismatch"
