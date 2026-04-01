"""Tests for TRON Exact client scheme."""

import pytest

from bankofai.x402.extensions.eip2612_gas_sponsoring import EIP2612_GAS_SPONSORING
from bankofai.x402.extensions.trc20_approval_gas_sponsoring import TRC20_APPROVAL_GAS_SPONSORING
from bankofai.x402.interfaces import PaymentPayloadContext
from bankofai.x402.mechanisms.tron.exact import ExactTronClientScheme
from bankofai.x402.schemas import PaymentRequirements


class DummySigner:
    address = "0x" + "11" * 20

    def sign_typed_data(self, *args, **kwargs):
        return "0x" + "aa" * 65

    def read_contract(self, address: str, function_name: str, args=None, **kwargs):
        if function_name == "allowance":
            return 0
        if function_name == "nonces":
            return 42
        return 0

    def build_trigger_smart_contract_transaction(self, **kwargs):
        return {"raw_data": {"contract": [{"parameter": {"value": {}}}]}}

    def sign_transaction(self, transaction):
        return {"raw_data": transaction.get("raw_data", {}), "signature": ["0x01"]}


class NoNoncesSigner(DummySigner):
    """Signer whose token doesn't support EIP-2612 (nonces call fails)."""

    def read_contract(self, address: str, function_name: str, args=None, **kwargs):
        if function_name == "nonces":
            raise Exception("function nonces not found in ABI")
        return super().read_contract(address, function_name, args)


def _base_requirements(extra: dict | None = None) -> PaymentRequirements:
    return PaymentRequirements(
        scheme="exact",
        network="tron:nile",
        asset="0x" + "22" * 20,
        amount="1000",
        pay_to="0x" + "33" * 20,
        max_timeout_seconds=3600,
        extra=extra or {},
    )


def test_create_eip3009_payload():
    client = ExactTronClientScheme(DummySigner())
    requirements = _base_requirements(extra={"name": "USDT", "version": "1"})
    payload = client.create_payment_payload(requirements)
    assert "authorization" in payload
    assert payload["authorization"]["from"] == DummySigner.address
    assert payload["authorization"]["to"] == requirements.pay_to
    assert payload["signature"].startswith("0x")


def test_create_permit2_payload(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.client as tron_client

    monkeypatch.setitem(tron_client.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(tron_client.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20)

    client = ExactTronClientScheme(DummySigner())
    requirements = _base_requirements(
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "0x" + "66" * 20,
        }
    )

    payload = client.create_payment_payload(requirements)
    assert "permit2Authorization" in payload
    assert payload["permit2Authorization"]["spender"] == "0x" + "55" * 20


def test_create_permit2_payload_with_trc20_extension(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.client as tron_client

    monkeypatch.setitem(tron_client.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(tron_client.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20)

    client = ExactTronClientScheme(DummySigner())
    requirements = _base_requirements(
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "0x" + "66" * 20,
        }
    )
    context = PaymentPayloadContext(extensions={TRC20_APPROVAL_GAS_SPONSORING.key: {}})

    payload, extensions = client.create_payment_payload(requirements, context)
    assert "permit2Authorization" in payload
    assert TRC20_APPROVAL_GAS_SPONSORING.key in extensions


def test_create_payload_requires_tip712_domain():
    client = ExactTronClientScheme(DummySigner())
    requirements = _base_requirements(extra={})
    with pytest.raises(ValueError, match="TIP-712 domain"):
        client.create_payment_payload(requirements)


def test_create_permit2_payload_with_eip2612_extension(monkeypatch):
    import bankofai.x402.mechanisms.tron.exact.client as tron_client

    monkeypatch.setitem(tron_client.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(tron_client.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20)

    client = ExactTronClientScheme(DummySigner())
    requirements = _base_requirements(
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "0x" + "66" * 20,
            "name": "Tether USD",
            "version": "1",
        }
    )
    context = PaymentPayloadContext(extensions={EIP2612_GAS_SPONSORING.key: {}})

    result = client.create_payment_payload(requirements, context)
    assert isinstance(result, tuple)
    payload, extensions = result
    assert "permit2Authorization" in payload
    assert EIP2612_GAS_SPONSORING.key in extensions
    info = extensions[EIP2612_GAS_SPONSORING.key]["info"]
    assert info["nonce"] == "42"
    assert info["signature"].startswith("0x")


def test_eip2612_extension_skipped_when_no_nonces(monkeypatch):
    """If token doesn't support EIP-2612, fall back to TRC-20 approval."""
    import bankofai.x402.mechanisms.tron.exact.client as tron_client

    monkeypatch.setitem(tron_client.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(tron_client.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20)

    client = ExactTronClientScheme(NoNoncesSigner())
    requirements = _base_requirements(
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "0x" + "66" * 20,
            "name": "Tether USD",
            "version": "1",
        }
    )
    # Both extensions available, but EIP-2612 should fail and fall through to TRC-20
    context = PaymentPayloadContext(
        extensions={
            EIP2612_GAS_SPONSORING.key: {},
            TRC20_APPROVAL_GAS_SPONSORING.key: {},
        }
    )

    result = client.create_payment_payload(requirements, context)
    assert isinstance(result, tuple)
    payload, extensions = result
    assert "permit2Authorization" in payload
    assert TRC20_APPROVAL_GAS_SPONSORING.key in extensions
    assert EIP2612_GAS_SPONSORING.key not in extensions


def test_eip2612_extension_skipped_when_allowance_sufficient(monkeypatch):
    """EIP-2612 extension not built if allowance already covers the amount."""
    import bankofai.x402.mechanisms.tron.exact.client as tron_client

    monkeypatch.setitem(tron_client.PERMIT2_ADDRESSES, "tron:nile", "0x" + "44" * 20)
    monkeypatch.setitem(tron_client.X402_PERMIT2_PROXY_ADDRESSES, "tron:nile", "0x" + "55" * 20)

    class SufficientAllowanceSigner(DummySigner):
        def read_contract(self, address, function_name, args=None, **kwargs):
            if function_name == "allowance":
                return 10**12  # More than enough
            return super().read_contract(address, function_name, args)

    client = ExactTronClientScheme(SufficientAllowanceSigner())
    requirements = _base_requirements(
        extra={
            "assetTransferMethod": "permit2",
            "permit2FacilitatorAddress": "0x" + "66" * 20,
            "name": "Tether USD",
            "version": "1",
        }
    )
    context = PaymentPayloadContext(extensions={EIP2612_GAS_SPONSORING.key: {}})

    result = client.create_payment_payload(requirements, context)
    # No extensions needed since allowance is sufficient
    assert isinstance(result, dict)
    assert "permit2Authorization" in result
