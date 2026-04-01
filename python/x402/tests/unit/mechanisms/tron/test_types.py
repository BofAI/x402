"""Tests for TRON payload types."""

from bankofai.x402.mechanisms.tron import (
    ExactEIP3009Authorization,
    ExactEIP3009Payload,
    ExactPermit2Payload,
    ExactTronPayloadV1,
    Permit2Authorization,
    Permit2Witness,
    TypedDataDomain,
    TypedDataField,
    is_permit2_payload,
)


class TestExactEIP3009Payload:
    def test_round_trip(self):
        auth = ExactEIP3009Authorization(
            from_address="0x" + "11" * 20,
            to="0x" + "22" * 20,
            value="1000",
            valid_after="1",
            valid_before="2",
            nonce="0x" + "aa" * 32,
        )
        payload = ExactEIP3009Payload(authorization=auth, signature="0x" + "bb" * 65)
        restored = ExactEIP3009Payload.from_dict(payload.to_dict())
        assert restored.authorization.from_address == auth.from_address
        assert restored.authorization.to == auth.to
        assert restored.authorization.value == auth.value
        assert restored.signature == payload.signature


class TestExactPermit2Payload:
    def test_round_trip(self):
        auth = Permit2Authorization(
            from_address="0x" + "11" * 20,
            permitted_token="0x" + "22" * 20,
            permitted_amount="1000",
            spender="0x" + "33" * 20,
            nonce="1",
            deadline="2",
            witness=Permit2Witness(
                to="0x" + "44" * 20,
                facilitator="0x" + "55" * 20,
                valid_after="3",
            ),
        )
        payload = ExactPermit2Payload(permit2_authorization=auth, signature="0x" + "cc" * 65)
        restored = ExactPermit2Payload.from_dict(payload.to_dict())
        assert restored.permit2_authorization.from_address == auth.from_address
        assert restored.permit2_authorization.permitted_token == auth.permitted_token
        assert restored.permit2_authorization.witness.facilitator == auth.witness.facilitator
        assert restored.signature == payload.signature


class TestHelpers:
    def test_v1_alias(self):
        assert ExactTronPayloadV1 is ExactEIP3009Payload

    def test_is_permit2_payload(self):
        assert is_permit2_payload({"permit2Authorization": {}}) is True
        assert is_permit2_payload({"authorization": {}}) is False


class TestTypedDataTypes:
    def test_typed_data_domain(self):
        domain = TypedDataDomain(
            name="Permit2",
            version=None,
            chain_id=3448148188,
            verifying_contract="0x" + "44" * 20,
        )
        assert domain.name == "Permit2"
        assert domain.version is None
        assert domain.chain_id == 3448148188
        assert domain.verifying_contract == "0x" + "44" * 20

    def test_typed_data_domain_with_version(self):
        domain = TypedDataDomain(
            name="Tether USD",
            version="1",
            chain_id=3448148188,
            verifying_contract="0x" + "22" * 20,
        )
        assert domain.version == "1"

    def test_typed_data_field(self):
        field = TypedDataField(name="owner", type="address")
        assert field.name == "owner"
        assert field.type == "address"
