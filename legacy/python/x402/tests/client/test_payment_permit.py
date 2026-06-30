from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.mechanisms.tron.exact_permit import ExactPermitTronClientMechanism
from bankofai.x402.types import FeeInfo, PaymentRequirements, PaymentRequirementsExtra


@pytest.fixture
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "TTestBuyerAddress"
    signer.sign_typed_data = AsyncMock(return_value="0x" + "ab" * 65)
    signer.ensure_allowance = AsyncMock(return_value=True)
    return signer


@pytest.fixture
def nile_requirements():
    return PaymentRequirements(
        scheme="exact_permit",
        network="tron:nile",
        amount="1000000",
        asset="TTestUSDTAddress",
        payTo="TTestMerchantAddress",
        extra=PaymentRequirementsExtra(
            fee=FeeInfo(feeTo="TTestFacilitator", feeAmount="10000"),
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


class TestClientAuthorization:
    """客户端授权测试"""

    @pytest.mark.anyio
    async def test_ensure_allowance_called(self, mock_signer, nile_requirements, permit_context):
        """测试创建支付载荷时调用 ensure_allowance"""
        mechanism = ExactPermitTronClientMechanism(mock_signer)

        await mechanism.create_payment_payload(
            nile_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        # 验证调用了 ensure_allowance
        mock_signer.ensure_allowance.assert_called_once()
        call_args = mock_signer.ensure_allowance.call_args
        assert call_args[0][0] == nile_requirements.asset  # token
        assert call_args[0][1] == 1010000  # amount + fee
        assert call_args[0][2] == "tron:nile"  # network

    @pytest.mark.anyio
    async def test_allowance_amount_includes_fee(
        self, mock_signer, nile_requirements, permit_context
    ):
        """测试授权金额包含费用"""
        mechanism = ExactPermitTronClientMechanism(mock_signer)

        await mechanism.create_payment_payload(
            nile_requirements,
            "https://api.example.com/resource",
            extensions=permit_context,
        )

        # amount=1000000 + fee=10000 = 1010000
        call_args = mock_signer.ensure_allowance.call_args
        expected_total = int(nile_requirements.amount) + 10000
        assert call_args[0][1] == expected_total
