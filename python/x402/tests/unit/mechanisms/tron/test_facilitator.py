"""Tests for TRON facilitator scheme."""

import time

from bankofai.x402.mechanisms.tron.exact import ExactTronFacilitatorScheme
from bankofai.x402.schemas import PaymentPayload, PaymentRequirements


class DummySigner:
    def __init__(self):
        self._address = "0x" + "aa" * 20

    def get_addresses(self):
        return [self._address]

    def verify_typed_data(self, *args, **kwargs):
        return True

    def read_contract(self, *args, **kwargs):
        return 10**12

    def write_contract(self, *args, **kwargs):
        return "0x" + "00" * 32

    def wait_for_transaction_receipt(self, tx_hash: str):
        class Receipt:
            status = "success"

        return Receipt()


def _requirements() -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        asset="0x" + "11" * 20,
        amount="1000",
        pay_to="0x" + "22" * 20,
        max_timeout_seconds=3600,
        extra={"name": "USDT", "version": "1"},
    )


def _payload(req: PaymentRequirements) -> PaymentPayload:
    now = int(time.time())
    raw = {
        "authorization": {
            "from": "0x" + "33" * 20,
            "to": req.pay_to,
            "value": req.amount,
            "validAfter": str(now - 600),
            "validBefore": str(now + 3600),
            "nonce": "0x" + "11" * 32,
        },
        "signature": "0x" + "aa" * 65,
    }
    return PaymentPayload(x402_version=2, payload=raw, accepted=req)


def test_get_extra_returns_facilitator_address():
    scheme = ExactTronFacilitatorScheme(DummySigner())
    extra = scheme.get_extra("tron:nile")
    assert extra == {"permit2FacilitatorAddress": scheme.get_signers("tron:nile")[0]}


def test_verify_eip3009_path():
    scheme = ExactTronFacilitatorScheme(DummySigner())
    req = _requirements()
    payload = _payload(req)
    result = scheme.verify(payload, req)
    assert result.is_valid is True


def test_settle_eip3009_path():
    scheme = ExactTronFacilitatorScheme(DummySigner())
    req = _requirements()
    payload = _payload(req)
    result = scheme.settle(payload, req)
    assert result.success is True
