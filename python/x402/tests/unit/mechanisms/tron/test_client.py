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


class _Permit2CapableTronSigner(_MockTronSigner):
    def __init__(self, balance: int, allowance: int) -> None:
        super().__init__(balance)
        self._allowance = allowance
        self.write_calls: list[tuple[str, str]] = []

    def read_contract(self, address, function_name, args=None):
        if function_name == "balanceOf":
            return self._balance
        if function_name == "allowance":
            return self._allowance
        raise AssertionError(f"unexpected function {function_name}")

    def write_contract(self, address, function_name, args):
        self.write_calls.append((address, function_name))
        return "approvaltxid"

    def wait_for_transaction_receipt(self, tx_hash):
        assert tx_hash == "approvaltxid"
        return type("Receipt", (), {"status": "success"})()


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


def test_create_payment_payload_locally_approves_permit2_when_allowance_is_insufficient():
    signer = _Permit2CapableTronSigner(balance=1000, allowance=0)
    scheme = ExactTronClientScheme(signer)
    requirements = PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        asset="TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        amount="100",
        pay_to="TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
        max_timeout_seconds=300,
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "TSForFRqxmZdJ6Yfx2rNaFykhuQLc9cTMR",
        },
    )

    payload = scheme.create_payment_payload(requirements)

    assert "permit2Authorization" in payload
    assert signer.write_calls == [(requirements.asset, "approve")]
