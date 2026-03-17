"""Tests for TRON Permit2 facilitator logic."""

import time

from bankofai.x402.extensions.trc20_approval_gas_sponsoring import (
    TRC20_APPROVAL_GAS_SPONSORING,
    create_trc20_approval_gas_sponsoring_extension,
)
from bankofai.x402.interfaces import FacilitatorContext
from bankofai.x402.mechanisms.tron.constants import ERR_PERMIT2_ALLOWANCE_REQUIRED
from bankofai.x402.mechanisms.tron.exact.permit2 import settle_permit2, verify_permit2
from bankofai.x402.mechanisms.tron.types import ExactPermit2Payload
from bankofai.x402.schemas import PaymentPayload, PaymentRequirements


class DummySigner:
    def __init__(self, allowance: int, balance: int = 10**12, valid_signature: bool = True):
        self._allowance = allowance
        self._balance = balance
        self._valid_signature = valid_signature
        self._address = "0x" + "99" * 20

    def get_addresses(self):
        return [self._address]

    def verify_typed_data(self, *args, **kwargs):
        return self._valid_signature

    def read_contract(self, address: str, function_name: str, args=None):
        if function_name == "allowance":
            return self._allowance
        if function_name == "balanceOf":
            return self._balance
        return 0

    def write_contract_with_abi(self, *args, **kwargs):
        return "0x" + "00" * 32

    def wait_for_transaction_receipt(self, tx_hash: str):
        class Receipt:
            status = "success"

        return Receipt()

    def get_sign_weight(self, transaction):
        return {"result": {"result": True}}


class Base58ArgsSigner(DummySigner):
    def read_contract(self, address: str, function_name: str, args=None):
        args = args or []
        if function_name in {"allowance", "balanceOf"}:
            for arg in args:
                if isinstance(arg, str) and not (arg.startswith("T") and len(arg) == 34):
                    raise ValueError("EncodingTypeError")
        return super().read_contract(address, function_name, args)


class FailingApprovalSigner:
    def send_raw_transaction(self, signed_transaction):
        raise AssertionError("send_raw_transaction should not be called when allowance is sufficient")

    def wait_for_transaction_receipt(self, tx_hash: str):
        raise AssertionError(
            "wait_for_transaction_receipt should not be called when allowance is sufficient"
        )


class Base58WriteSigner(Base58ArgsSigner):
    def write_contract_with_abi(self, address, function_name, args, abi, fee_limit=1_000_000_000):
        permit_tuple = args[0]
        payer = args[1]
        witness = args[2]

        token = permit_tuple[0][0]
        assert isinstance(token, str) and token.startswith("T") and len(token) == 34
        assert isinstance(payer, str) and payer.startswith("T") and len(payer) == 34
        assert isinstance(witness[0], str) and witness[0].startswith("T") and len(witness[0]) == 34
        assert isinstance(witness[1], str) and witness[1].startswith("T") and len(witness[1]) == 34
        return "0x" + "00" * 32


def _requirements() -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        asset="0x" + "11" * 20,
        amount="1000",
        pay_to="0x" + "22" * 20,
        max_timeout_seconds=3600,
    )


def _payload_dict(req: PaymentRequirements, signer_address: str) -> dict:
    now = int(time.time())
    return {
        "signature": "0x" + "11" * 65,
        "permit2Authorization": {
            "from": "0x" + "33" * 20,
            "permitted": {"token": req.asset, "amount": req.amount},
            "spender": "0x" + "55" * 20,
            "nonce": "1",
            "deadline": str(now + 3600),
            "witness": {
                "to": req.pay_to,
                "facilitator": signer_address,
                "validAfter": str(now - 600),
            },
        },
    }


def test_verify_permit2_valid(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = DummySigner(allowance=10**9)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])
    payload = PaymentPayload(x402_version=2, payload=payload_dict, accepted=req)

    result = verify_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.is_valid is True


def test_verify_permit2_allowance_required(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = DummySigner(allowance=0)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])
    payload = PaymentPayload(x402_version=2, payload=payload_dict, accepted=req)

    result = verify_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.is_valid is False
    assert result.invalid_reason == ERR_PERMIT2_ALLOWANCE_REQUIRED


def test_settle_permit2_success(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = DummySigner(allowance=10**9)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])
    payload = PaymentPayload(x402_version=2, payload=payload_dict, accepted=req)

    result = settle_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.success is True


def test_verify_permit2_allows_trc20_extension(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = DummySigner(allowance=0)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])

    spender_word = ("0x" + "44" * 20).removeprefix("0x").rjust(64, "0")
    amount_word = hex((1 << 256) - 1).removeprefix("0x").rjust(64, "0")
    approval_data = "095ea7b3" + spender_word + amount_word

    payload = PaymentPayload(
        x402_version=2,
        payload=payload_dict,
        accepted=req,
        extensions={
            TRC20_APPROVAL_GAS_SPONSORING.key: {
                "info": {
                    "from": payload_dict["permit2Authorization"]["from"],
                    "asset": req.asset,
                    "spender": "0x" + "44" * 20,
                    "amount": str((1 << 256) - 1),
                    "signedTransaction": {
                        "raw_data": {
                            "contract": [
                                {
                                    "parameter": {
                                        "value": {
                                            "owner_address": payload_dict["permit2Authorization"][
                                                "from"
                                            ],
                                            "contract_address": req.asset,
                                            "data": approval_data,
                                        }
                                    }
                                }
                            ]
                        },
                        "signature": ["0x01"],
                    },
                    "version": "1",
                }
            }
        },
    )

    context = FacilitatorContext(
        {TRC20_APPROVAL_GAS_SPONSORING.key: create_trc20_approval_gas_sponsoring_extension(signer)}
    )

    result = verify_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
        context,
    )
    assert result.is_valid is True


def test_verify_permit2_ignores_server_declared_extension_when_allowance_sufficient(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = Base58ArgsSigner(allowance=10**9)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])
    payload = PaymentPayload(
        x402_version=2,
        payload=payload_dict,
        accepted=req,
        extensions={
            TRC20_APPROVAL_GAS_SPONSORING.key: {
                "info": {"description": "TRC-20 approval gas sponsoring (Permit2)", "version": "1"},
                "schema": {},
            }
        },
    )

    result = verify_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.is_valid is True


def test_settle_permit2_skips_trc20_approval_when_allowance_sufficient(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = Base58ArgsSigner(allowance=10**9)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])

    payload = PaymentPayload(
        x402_version=2,
        payload=payload_dict,
        accepted=req,
        extensions={
            TRC20_APPROVAL_GAS_SPONSORING.key: {
                "info": {
                    "from": payload_dict["permit2Authorization"]["from"],
                    "asset": req.asset,
                    "spender": "0x" + "44" * 20,
                    "amount": str((1 << 256) - 1),
                    "signedTransaction": {"raw_data": {"contract": []}, "signature": ["0x01"]},
                    "version": "1",
                },
                "schema": {},
            }
        },
    )

    context = FacilitatorContext(
        {
            TRC20_APPROVAL_GAS_SPONSORING.key: create_trc20_approval_gas_sponsoring_extension(
                FailingApprovalSigner()
            )
        }
    )

    result = settle_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
        context,
    )
    assert result.success is True


def test_settle_permit2_uses_base58_addresses_in_contract_call(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.permit2 as tron_permit2

    monkeypatch.setitem(tron_permit2.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(
        tron_permit2.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20
    )

    req = _requirements()
    signer = Base58WriteSigner(allowance=10**9)
    payload_dict = _payload_dict(req, signer.get_addresses()[0])
    payload = PaymentPayload(x402_version=2, payload=payload_dict, accepted=req)

    result = settle_permit2(
        signer,
        payload,
        req,
        ExactPermit2Payload.from_dict(payload_dict),
    )
    assert result.success is True
