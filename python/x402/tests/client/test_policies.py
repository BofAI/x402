import pytest
from unittest.mock import AsyncMock

from bankofai.x402.clients import SufficientBalancePolicy, X402Client
from bankofai.x402.types import FeeInfo, PaymentRequirements, PaymentRequirementsExtra


class DummyMechanism:
    def __init__(self, scheme: str, signer, context=None):
        self._scheme = scheme
        self._signer = signer
        self._context = context

    def scheme(self) -> str:
        return self._scheme

    def get_signer(self):
        return self._signer

    async def resolve_balance_check_context(self, requirements):
        return self._context

    async def create_payment_payload(self, requirements, resource, extensions=None):
        raise RuntimeError("not used")


@pytest.mark.asyncio
async def test_sufficient_balance_policy_filters_gasfree_on_subaddress():
    network = "tron:nile"
    asset = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
    gasfree_address = "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"

    async def gasfree_balance(_token, _network, address=None):
        return 1100 if address == gasfree_address else 0

    gasfree_signer = type("GasfreeSigner", (), {})()
    gasfree_signer.check_balance = AsyncMock(side_effect=gasfree_balance)

    exact_signer = type("ExactSigner", (), {})()
    exact_signer.check_balance = AsyncMock(return_value=9999)

    gasfree_mech = DummyMechanism(
        "exact_gasfree",
        gasfree_signer,
        context={"address": gasfree_address, "extra_needed": 200},
    )
    exact_mech = DummyMechanism("exact", exact_signer)

    client = X402Client()
    client.register("tron:*", gasfree_mech)
    client.register("tron:*", exact_mech)

    policy = SufficientBalancePolicy(client)
    requirements = [
        PaymentRequirements(
            scheme="exact_gasfree",
            network=network,
            amount="1000",
            asset=asset,
            payTo="TTestPayTo",
            extra=PaymentRequirementsExtra(
                fee=FeeInfo(feeTo="TTestFeeTo", feeAmount="1000")
            ),
        ),
        PaymentRequirements(
            scheme="exact",
            network=network,
            amount="500",
            asset=asset,
            payTo="TTestPayTo",
        ),
    ]

    result = await policy.apply(requirements)

    assert [r.scheme for r in result] == ["exact"]
    gasfree_signer.check_balance.assert_any_call(
        asset, network, address=gasfree_address
    )


@pytest.mark.asyncio
async def test_sufficient_balance_policy_uses_extra_needed_override():
    network = "tron:nile"
    asset = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"
    gasfree_address = "TLCvf7MktLG7XkbJRyUwnvCeDnaEXYkcbC"

    async def gasfree_balance(_token, _network, address=None):
        return 1500 if address == gasfree_address else 0

    gasfree_signer = type("GasfreeSigner", (), {})()
    gasfree_signer.check_balance = AsyncMock(side_effect=gasfree_balance)

    gasfree_mech = DummyMechanism(
        "exact_gasfree",
        gasfree_signer,
        context={"address": gasfree_address, "extra_needed": 200},
    )

    client = X402Client()
    client.register("tron:*", gasfree_mech)

    policy = SufficientBalancePolicy(client)
    requirements = [
        PaymentRequirements(
            scheme="exact_gasfree",
            network=network,
            amount="1000",
            asset=asset,
            payTo="TTestPayTo",
            extra=PaymentRequirementsExtra(
                fee=FeeInfo(feeTo="TTestFeeTo", feeAmount="1000")
            ),
        )
    ]

    result = await policy.apply(requirements)

    assert [r.scheme for r in result] == ["exact_gasfree"]
    gasfree_signer.check_balance.assert_any_call(
        asset, network, address=gasfree_address
    )
