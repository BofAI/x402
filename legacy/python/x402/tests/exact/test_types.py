"""
Tests for exact types and helpers.
"""

import time

from bankofai.x402.mechanisms._exact_base.types import (
    SCHEME_EXACT,
    TRANSFER_AUTH_EIP712_TYPES,
    TRANSFER_AUTH_PRIMARY_TYPE,
    TransferAuthorization,
    build_eip712_domain,
    build_eip712_message,
    create_nonce,
    create_validity_window,
)


class TestTransferAuthorization:
    def test_create_with_alias(self):
        auth = TransferAuthorization(
            **{
                "from": "TFromAddress",
                "to": "TToAddress",
                "value": "1000000",
                "validAfter": "100",
                "validBefore": "200",
                "nonce": "0x" + "ab" * 32,
            }
        )
        assert auth.from_address == "TFromAddress"
        assert auth.to == "TToAddress"
        assert auth.value == "1000000"
        assert auth.valid_after == "100"
        assert auth.valid_before == "200"
        assert len(auth.nonce) == 66  # 0x + 64 hex chars

    def test_dump_by_alias(self):
        auth = TransferAuthorization(
            **{
                "from": "TFrom",
                "to": "TTo",
                "value": "100",
                "validAfter": "0",
                "validBefore": "999",
                "nonce": "0x" + "00" * 32,
            }
        )
        dumped = auth.model_dump(by_alias=True)
        assert "from" in dumped
        assert "validAfter" in dumped
        assert "validBefore" in dumped
        assert "from_address" not in dumped


class TestCreateNonce:
    def test_nonce_format(self):
        nonce = create_nonce()
        assert nonce.startswith("0x")
        assert len(nonce) == 66  # 0x + 64 hex chars

    def test_nonce_uniqueness(self):
        nonces = {create_nonce() for _ in range(100)}
        assert len(nonces) == 100


class TestCreateValidityWindow:
    def test_default_window(self):
        valid_after, valid_before = create_validity_window()
        now = int(time.time())
        assert valid_after <= now
        assert valid_before > now
        assert valid_before - valid_after > 3600

    def test_custom_duration(self):
        valid_after, valid_before = create_validity_window(duration=60)
        now = int(time.time())
        assert valid_before - now <= 60
        assert valid_after < now


class TestBuildEip712Message:
    def test_builds_correct_message(self):
        auth = TransferAuthorization(
            **{
                "from": "0xFromAddr",
                "to": "0xToAddr",
                "value": "1000000",
                "validAfter": "100",
                "validBefore": "200",
                "nonce": "0x" + "ab" * 32,
            }
        )
        msg = build_eip712_message(auth)
        assert msg["from"] == "0xFromAddr"
        assert msg["to"] == "0xToAddr"
        assert msg["value"] == 1000000
        assert msg["validAfter"] == 100
        assert msg["validBefore"] == 200
        assert isinstance(msg["nonce"], bytes)
        assert len(msg["nonce"]) == 32


class TestBuildEip712Domain:
    def test_builds_correct_domain(self):
        domain = build_eip712_domain("Tether USD", "1", 728126428, "0xTokenAddr")
        assert domain["name"] == "Tether USD"
        assert domain["version"] == "1"
        assert domain["chainId"] == 728126428
        assert domain["verifyingContract"] == "0xTokenAddr"


class TestConstants:
    def test_scheme_name(self):
        assert SCHEME_EXACT == "exact"

    def test_primary_type(self):
        assert TRANSFER_AUTH_PRIMARY_TYPE == "TransferWithAuthorization"

    def test_eip712_types_has_transfer_with_authorization(self):
        assert "TransferWithAuthorization" in TRANSFER_AUTH_EIP712_TYPES
        fields = TRANSFER_AUTH_EIP712_TYPES["TransferWithAuthorization"]
        field_names = [f["name"] for f in fields]
        assert "from" in field_names
        assert "to" in field_names
        assert "value" in field_names
        assert "validAfter" in field_names
        assert "validBefore" in field_names
        assert "nonce" in field_names
