from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.clients import X402Client
from bankofai.x402.clients.policies import SufficientBalancePolicy
from bankofai.x402.types import PaymentRequirements


def _req(**overrides):
    defaults = dict(
        scheme="exact_permit",
        network="tron:nile",
        amount="1000000",
        asset="TTestUSDT",
        payTo="TTestMerchant",
    )
    defaults.update(overrides)
    return PaymentRequirements(**defaults)


def _mechanism(scheme="exact_permit", check_balance=None, signer=None):
    m = MagicMock()
    m.scheme.return_value = scheme
    m.get_signer.return_value = signer
    if check_balance is not None:
        m.check_balance = check_balance
    else:
        del m.check_balance
    m.create_payment_payload = AsyncMock(return_value={"mock": "payload"})
    return m


def _signer(balance=5000000):
    s = MagicMock()
    s.check_balance = AsyncMock(return_value=balance)
    s.get_address.return_value = "TMockAddress"
    return s


@pytest.mark.anyio
async def test_keeps_requirement_with_sufficient_balance():
    client = X402Client()
    mech = _mechanism(check_balance=AsyncMock(return_value=5000000))
    client.register("tron:*", mech)

    policy = SufficientBalancePolicy(client)
    result = await policy.apply([_req(amount="1000000")])
    assert len(result) == 1


@pytest.mark.anyio
async def test_drops_requirement_with_insufficient_balance():
    client = X402Client()
    mech = _mechanism(check_balance=AsyncMock(return_value=500))
    client.register("tron:*", mech)

    policy = SufficientBalancePolicy(client)
    result = await policy.apply([_req(amount="1000000")])
    assert len(result) == 0


@pytest.mark.anyio
async def test_drops_requirement_when_no_mechanism():
    client = X402Client()
    policy = SufficientBalancePolicy(client)
    result = await policy.apply([_req()])
    assert len(result) == 0


@pytest.mark.anyio
async def test_keeps_requirement_when_check_balance_raises():
    client = X402Client()
    mech = _mechanism(
        check_balance=AsyncMock(side_effect=RuntimeError("network error")),
    )
    client.register("tron:*", mech)

    policy = SufficientBalancePolicy(client)
    result = await policy.apply([_req()])
    assert len(result) == 1


@pytest.mark.anyio
async def test_returns_empty_when_all_unaffordable():
    client = X402Client()
    mech = _mechanism(check_balance=AsyncMock(return_value=0))
    client.register("tron:*", mech)

    policy = SufficientBalancePolicy(client)
    result = await policy.apply([_req(amount="1000000"), _req(amount="2000000")])
    assert len(result) == 0
