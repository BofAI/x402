"""
Tests for ExactGasFreeClientMechanism.
"""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bankofai.x402.abi import GASFREE_PRIMARY_TYPE
from bankofai.x402.mechanisms.tron.exact_gasfree.client import ExactGasFreeClientMechanism
from bankofai.x402.types import FeeInfo, PaymentRequirements, PaymentRequirementsExtra

USDT_ADDRESS = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
PROVIDER_ADDRESS = "TKtWbdzEq5ss9vTS9kwRhBp5mXmBfBns3E"
MERCHANT_ADDRESS = "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E"


def _make_gasfree_mechanism():
    mech = ExactGasFreeClientMechanism.__new__(ExactGasFreeClientMechanism)
    import logging

    mech._logger = logging.getLogger("test")
    return mech


def test_gasfree_deadline_clamp_mainnet_and_testnet():
    mech = _make_gasfree_mechanism()
    now = int(time.time())

    # Mainnet: clamp down to now + 595 when above max (600 - 5 safety margin)
    result_mainnet = mech._clamp_deadline("tron:mainnet", now + 1000)
    assert result_mainnet == now + 595

    # Nile: clamp down to now + 3595 when above max (3600 - 5 safety margin)
    result_nile = mech._clamp_deadline("tron:nile", now + 4000)
    assert result_nile == now + 3595


def test_gasfree_deadline_too_soon_raises():
    mech = _make_gasfree_mechanism()
    now = int(time.time())
    with pytest.raises(ValueError, match="deadline too soon"):
        mech._clamp_deadline("tron:mainnet", now + 10)


@pytest.fixture
def mock_signer():
    signer = MagicMock()
    signer.get_address.return_value = "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E"
    signer.sign_typed_data = AsyncMock(return_value="0x" + "ab" * 65)
    signer.check_balance = AsyncMock(return_value=5000000)
    return signer


@pytest.fixture
def nile_requirements():
    return PaymentRequirements(
        scheme="exact_gasfree",
        network="tron:nile",
        amount="1000000",
        asset=USDT_ADDRESS,
        payTo=MERCHANT_ADDRESS,
        maxTimeoutSeconds=3600,
        extra=PaymentRequirementsExtra(
            fee=FeeInfo(feeTo=PROVIDER_ADDRESS, feeAmount="0"),
        ),
    )


@pytest.fixture
def mock_api_client():
    with patch("bankofai.x402.mechanisms.tron.exact_gasfree.client.GasFreeAPIClient") as mock:
        client_instance = mock.return_value
        client_instance.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": True,
                "nonce": 1,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 5000000,
                        "transferFee": 1000000,
                    }
                ],
            }
        )
        client_instance.get_providers = AsyncMock(return_value=[{"address": MERCHANT_ADDRESS}])
        yield client_instance


class TestGasFreeClient:
    @pytest.mark.anyio
    async def test_create_payment_payload(self, mock_signer, nile_requirements, mock_api_client):
        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        assert payload.x402_version == 2
        assert payload.resource.url == "https://example.com/resource"
        assert payload.accepted == nile_requirements
        assert payload.payload.signature == "0x" + "ab" * 65
        assert payload.extensions["gasfreeAddress"] == "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"
        assert payload.payload.payment_permit.meta.nonce == "1"

        # Verify primary_type was passed
        mock_signer.sign_typed_data.assert_called_once()
        assert mock_signer.sign_typed_data.call_args.kwargs["primary_type"] == GASFREE_PRIMARY_TYPE
        domain = mock_signer.sign_typed_data.call_args.kwargs["domain"]
        message = mock_signer.sign_typed_data.call_args.kwargs["message"]
        assert domain["verifyingContract"].startswith("0x")
        assert message["token"].startswith("0x")
        assert message["serviceProvider"].startswith("0x")
        assert message["user"].startswith("0x")
        assert message["receiver"].startswith("0x")

    @pytest.mark.anyio
    async def test_max_fee_adjustment(self, mock_signer, nile_requirements, mock_api_client):
        # Requirements has 0.1 USDT fee, but protocol needs 1 USDT
        nile_requirements.extra = PaymentRequirementsExtra(
            fee=FeeInfo(feeTo=PROVIDER_ADDRESS, feeAmount="100000"),
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(
            nile_requirements, "https://example.com/resource"
        )

        # Should be adjusted to 1 USDT (10^6)
        assert payload.payload.payment_permit.fee.fee_amount == "1000000"

    @pytest.mark.anyio
    async def test_insufficient_balance(self, mock_signer, nile_requirements, mock_api_client):
        from bankofai.x402.exceptions import InsufficientGasFreeBalance

        mock_signer.check_balance = AsyncMock(return_value=1000000)

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        with pytest.raises(InsufficientGasFreeBalance):
            await mechanism.create_payment_payload(nile_requirements, "https://example.com")

    @pytest.mark.anyio
    async def test_fallback_fetch_providers(self, mock_signer, mock_api_client):
        """When extra.fee is missing, client falls back to fetching providers from API"""
        requirements_no_fee = PaymentRequirements(
            scheme="exact_gasfree",
            network="tron:nile",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo=MERCHANT_ADDRESS,
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(
            requirements_no_fee, "https://example.com/resource"
        )

        # Should have called get_providers as fallback
        mock_api_client.get_providers.assert_called_once()
        assert payload.x402_version == 2

    @pytest.mark.anyio
    async def test_activate_fee_included_when_not_active(
        self, mock_signer, nile_requirements, mock_api_client
    ):
        """activateFee should be added to maxFee when account is not activated"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 15000000,
                        "transferFee": 1000000,
                        "activateFee": 2050000,
                    }
                ],
            }
        )
        mock_signer.check_balance = AsyncMock(return_value=15000000)

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        # maxFee = transferFee(1000000) + activateFee(2050000) = 3050000
        assert payload.payload.payment_permit.fee.fee_amount == "3050000"

    @pytest.mark.anyio
    async def test_activate_fee_not_added_when_active(
        self, mock_signer, nile_requirements, mock_api_client
    ):
        """activateFee should NOT be added to maxFee when account is already activated"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": True,
                "nonce": 1,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 5000000,
                        "transferFee": 1000000,
                        "activateFee": 2050000,
                    }
                ],
            }
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        # activateFee should be ignored since account is active
        assert payload.payload.payment_permit.fee.fee_amount == "1000000"

    @pytest.mark.anyio
    async def test_activate_fee_zero_when_not_active(
        self, mock_signer, nile_requirements, mock_api_client
    ):
        """When activateFee is 0 and account not active, maxFee should not change"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 5000000,
                        "transferFee": 1000000,
                        "activateFee": 0,
                    }
                ],
            }
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        # activateFee is 0, so maxFee stays as transferFee
        assert payload.payload.payment_permit.fee.fee_amount == "1000000"

    @pytest.mark.anyio
    async def test_activate_fee_missing_from_asset(
        self, mock_signer, nile_requirements, mock_api_client
    ):
        """When activateFee field is absent from asset, should default to 0"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 5000000,
                        "transferFee": 1000000,
                        # activateFee field missing entirely
                    }
                ],
            }
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(nile_requirements, "https://example.com")

        # No activateFee → defaults to 0 → maxFee stays as transferFee
        assert payload.payload.payment_permit.fee.fee_amount == "1000000"

    @pytest.mark.anyio
    async def test_activate_fee_with_higher_facilitator_fee(self, mock_signer, mock_api_client):
        """activateFee should be added on top of whichever is higher (facilitator vs transfer)"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 20000000,
                        "transferFee": 1000000,
                        "activateFee": 2050000,
                    }
                ],
            }
        )
        mock_signer.check_balance = AsyncMock(return_value=20000000)

        requirements = PaymentRequirements(
            scheme="exact_gasfree",
            network="tron:nile",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo=MERCHANT_ADDRESS,
            maxTimeoutSeconds=3600,
            extra=PaymentRequirementsExtra(
                fee=FeeInfo(feeTo=PROVIDER_ADDRESS, feeAmount="5000000"),
            ),
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(requirements, "https://example.com")

        # facilitatorFee(5000000) > transferFee(1000000), so base = 5000000
        # maxFee = 5000000 + activateFee(2050000) = 7050000
        assert payload.payload.payment_permit.fee.fee_amount == "7050000"

    @pytest.mark.anyio
    async def test_activate_fee_balance_check_includes_activate_fee(
        self, mock_signer, nile_requirements, mock_api_client
    ):
        """Balance check should account for activateFee in the required total"""
        from bankofai.x402.exceptions import InsufficientGasFreeBalance

        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 3000000,
                        "transferFee": 1000000,
                        "activateFee": 2050000,
                    }
                ],
            }
        )
        # Balance = 3000000, but need amount(1000000) + maxFee(3050000) = 4050000
        mock_signer.check_balance = AsyncMock(return_value=3000000)

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        with pytest.raises(InsufficientGasFreeBalance):
            await mechanism.create_payment_payload(nile_requirements, "https://example.com")

    @pytest.mark.anyio
    async def test_activate_fee_on_top_of_fallback_minimum(self, mock_signer, mock_api_client):
        """activateFee should be added on top of fallback 1-token minimum"""
        mock_api_client.get_address_info = AsyncMock(
            return_value={
                "accountAddress": "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E",
                "gasFreeAddress": "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC",
                "active": False,
                "allowSubmit": True,
                "nonce": 0,
                "assets": [
                    {
                        "tokenAddress": USDT_ADDRESS,
                        "balance": 10000000,
                        "transferFee": 0,
                        "activateFee": 2050000,
                    }
                ],
            }
        )
        mock_signer.check_balance = AsyncMock(return_value=10000000)

        # No extra.fee → triggers fallback to 1 token (1000000)
        requirements_no_fee = PaymentRequirements(
            scheme="exact_gasfree",
            network="tron:nile",
            amount="1000000",
            asset=USDT_ADDRESS,
            payTo=MERCHANT_ADDRESS,
        )

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        payload = await mechanism.create_payment_payload(requirements_no_fee, "https://example.com")

        # fallback(1000000) + activateFee(2050000) = 3050000
        assert payload.payload.payment_permit.fee.fee_amount == "3050000"

    @pytest.mark.anyio
    async def test_not_activated(self, mock_signer, nile_requirements, mock_api_client):
        from bankofai.x402.exceptions import GasFreeAccountNotActivated

        mock_api_client.get_address_info.return_value["active"] = False

        mechanism = ExactGasFreeClientMechanism(mock_signer, clients={"tron:nile": mock_api_client})
        with pytest.raises(GasFreeAccountNotActivated):
            await mechanism.create_payment_payload(nile_requirements, "https://example.com")
