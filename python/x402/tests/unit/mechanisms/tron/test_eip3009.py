"""Tests for TRON EIP-3009 facilitator logic."""

import time

from bankofai.x402.mechanisms.tron.constants import ERR_INVALID_SIGNATURE
from bankofai.x402.mechanisms.tron.exact.eip3009 import settle_eip3009, verify_eip3009
from bankofai.x402.schemas import PaymentPayload, PaymentRequirements


class DummySigner:
    def __init__(self, valid_signature: bool = True):
        self._valid_signature = valid_signature

    def verify_typed_data(self, *args, **kwargs):
        return self._valid_signature

    def read_contract(self, *args, **kwargs):
        return 10**12

    def write_contract(self, *args, **kwargs):
        return "0x" + "00" * 32

    def wait_for_transaction_receipt(self, tx_hash: str):
        class Receipt:
            status = "success"

        return Receipt()


class Base58WriteSigner(DummySigner):
    def read_contract(self, address, function_name, args=None, **kwargs):
        args = args or []
        for arg in args:
            if isinstance(arg, str):
                assert arg.startswith("T") and len(arg) == 34
        return super().read_contract(address, function_name, args)

    def write_contract(self, address, function_name, args, fee_limit=1_000_000_000):
        for arg in args[:2]:
            if isinstance(arg, str):
                assert arg.startswith("T") and len(arg) == 34
        return super().write_contract(address, function_name, args, fee_limit)


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


def _raw_payload(req: PaymentRequirements) -> dict:
    now = int(time.time())
    return {
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


def test_verify_eip3009_valid():
    req = _requirements()
    raw = _raw_payload(req)
    payload = PaymentPayload(x402_version=2, payload=raw, accepted=req)
    result = verify_eip3009(DummySigner(valid_signature=True), payload, req, raw)
    assert result.is_valid is True


def test_verify_eip3009_invalid_signature():
    req = _requirements()
    raw = _raw_payload(req)
    payload = PaymentPayload(x402_version=2, payload=raw, accepted=req)
    result = verify_eip3009(DummySigner(valid_signature=False), payload, req, raw)
    assert result.is_valid is False
    assert result.invalid_reason == ERR_INVALID_SIGNATURE


def test_settle_eip3009_success():
    req = _requirements()
    raw = _raw_payload(req)
    payload = PaymentPayload(x402_version=2, payload=raw, accepted=req)
    result = settle_eip3009(DummySigner(valid_signature=True), payload, req, raw)
    assert result.success is True


def test_eip3009_uses_base58_addresses_for_contract_calls():
    req = _requirements()
    raw = _raw_payload(req)
    payload = PaymentPayload(x402_version=2, payload=raw, accepted=req)

    verify_result = verify_eip3009(Base58WriteSigner(valid_signature=True), payload, req, raw)
    assert verify_result.is_valid is True

    settle_result = settle_eip3009(Base58WriteSigner(valid_signature=True), payload, req, raw)
    assert settle_result.success is True
