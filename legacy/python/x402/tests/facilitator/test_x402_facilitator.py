import pytest

from bankofai.x402.facilitator.x402_facilitator import X402Facilitator
from bankofai.x402.types import PaymentRequirements


class DummyMechanism:
    def scheme(self) -> str:
        return "exact_permit"

    async def fee_quote(self, accept: PaymentRequirements, context=None):
        raise RuntimeError("quote failed")

    async def verify(self, payload, requirements):
        raise NotImplementedError

    async def settle(self, payload, requirements):
        raise NotImplementedError


@pytest.mark.anyio
async def test_fee_quote_raises_on_invalid_requirements() -> None:
    facilitator = X402Facilitator()
    facilitator.register(["eip155:97"], DummyMechanism())

    bad_requirements = PaymentRequirements(
        scheme="exact_permit",
        network="eip155:97",
        amount="1",
        asset="0x1234",
        payTo="0x375caDdd2cB68cE82e3D9B075D551067a7b4B816",
    )

    with pytest.raises(ValueError, match="Invalid payment requirements"):
        await facilitator.fee_quote([bad_requirements])


@pytest.mark.anyio
async def test_fee_quote_raises_on_mechanism_failure() -> None:
    facilitator = X402Facilitator()
    facilitator.register(["eip155:97"], DummyMechanism())

    requirements = PaymentRequirements(
        scheme="exact_permit",
        network="eip155:97",
        amount="1",
        asset="0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
        payTo="0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
    )

    with pytest.raises(RuntimeError, match="Fee quote failed"):
        await facilitator.fee_quote([requirements])
