"""Tests for ExactTronClientScheme client balance preflight."""

try:
    from bankofai.x402.mechanisms.tron.exact.client import ExactTronClientScheme
except ImportError:
    import pytest

    pytest.skip("TRON client requires tronpy", allow_module_level=True)

from bankofai.x402.schemas import PaymentRequirements


class _MockTronSigner:
    address = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"

    def __init__(self, balance: int) -> None:
        self._balance = balance

    def sign_typed_data(
        self, domain, types, primary_type, message
    ):  # pragma: no cover - not reached
        return "0xdeadbeef"

    def read_contract(self, address, function_name, args=None):
        assert function_name == "balanceOf"
        return self._balance


def test_create_payment_payload_fails_fast_on_insufficient_balance():
    signer = _MockTronSigner(balance=0)
    scheme = ExactTronClientScheme(signer)
    requirements = PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        asset="TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        amount="100",
        pay_to="TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
        max_timeout_seconds=300,
        extra={"name": "Tether USD", "version": "1"},
    )

    try:
        scheme.create_payment_payload(requirements)
        raise AssertionError("expected insufficient_funds error")
    except ValueError as exc:
        assert "insufficient_funds" in str(exc)
