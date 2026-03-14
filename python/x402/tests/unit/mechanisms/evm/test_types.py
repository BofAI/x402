"""Tests for EVM payload types."""

from bankofai.x402.mechanisms.evm import (
    ExactEIP3009Authorization,
    ExactEIP3009Payload,
    ExactEvmPayloadV1,
    ExactEvmPayloadV2,
    ExactPermit2Authorization,
    ExactPermit2Payload,
    Permit2Witness,
)


class TestExactEIP3009Authorization:
    """Test ExactEIP3009Authorization type."""

    def test_should_accept_valid_authorization_structure(self):
        """Should accept valid authorization structure."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        assert auth.from_address is not None
        assert auth.to is not None
        assert auth.value is not None
        assert isinstance(auth.value, str)
        assert auth.nonce.startswith("0x")

    def test_should_accept_empty_address_strings(self):
        """Should accept empty address strings."""
        auth = ExactEIP3009Authorization(
            from_address="",
            to="",
            value="0",
            valid_after="0",
            valid_before="0",
            nonce="0x00",
        )

        assert auth.from_address == ""
        assert auth.to == ""


class TestExactEIP3009Payload:
    """Test ExactEIP3009Payload type."""

    def test_should_create_payload_with_authorization(self):
        """Should create payload with authorization."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        payload = ExactEIP3009Payload(authorization=auth)

        assert payload.authorization == auth
        assert payload.signature is None

    def test_should_create_payload_with_signature(self):
        """Should create payload with signature."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        payload = ExactEIP3009Payload(authorization=auth, signature="0x1234")

        assert payload.signature == "0x1234"

    def test_to_dict_should_return_dict_with_authorization(self):
        """to_dict should return dict with authorization field."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        payload = ExactEIP3009Payload(authorization=auth)
        result = payload.to_dict()

        assert "authorization" in result
        assert result["authorization"]["from"] == auth.from_address
        assert result["authorization"]["to"] == auth.to
        assert result["authorization"]["value"] == auth.value
        assert "signature" not in result  # None signatures are omitted

    def test_to_dict_should_include_signature_if_present(self):
        """to_dict should include signature if present."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        payload = ExactEIP3009Payload(authorization=auth, signature="0xabcd")
        result = payload.to_dict()

        assert result["signature"] == "0xabcd"

    def test_from_dict_should_create_payload_from_dict(self):
        """from_dict should create payload from dict."""
        data = {
            "authorization": {
                "from": "0x1234567890123456789012345678901234567890",
                "to": "0x0987654321098765432109876543210987654321",
                "value": "1000000",
                "validAfter": "1000000000",
                "validBefore": "1000003600",
                "nonce": "0x" + "00" * 32,
            },
            "signature": "0x1234",
        }

        payload = ExactEIP3009Payload.from_dict(data)

        assert payload.authorization.from_address == data["authorization"]["from"]
        assert payload.authorization.to == data["authorization"]["to"]
        assert payload.signature == "0x1234"

    def test_from_dict_should_handle_missing_signature(self):
        """from_dict should handle missing signature."""
        data = {
            "authorization": {
                "from": "0x1234567890123456789012345678901234567890",
                "to": "0x0987654321098765432109876543210987654321",
                "value": "1000000",
                "validAfter": "1000000000",
                "validBefore": "1000003600",
                "nonce": "0x" + "00" * 32,
            }
        }

        payload = ExactEIP3009Payload.from_dict(data)

        assert payload.signature is None

    def test_round_trip_serialization(self):
        """Should preserve data through serialization round-trip."""
        auth = ExactEIP3009Authorization(
            from_address="0x1234567890123456789012345678901234567890",
            to="0x0987654321098765432109876543210987654321",
            value="1000000",
            valid_after="1000000000",
            valid_before="1000003600",
            nonce="0x" + "00" * 32,
        )

        original = ExactEIP3009Payload(authorization=auth, signature="0xabcd")
        serialized = original.to_dict()
        restored = ExactEIP3009Payload.from_dict(serialized)

        assert restored.authorization.from_address == original.authorization.from_address
        assert restored.authorization.to == original.authorization.to
        assert restored.authorization.value == original.authorization.value
        assert restored.signature == original.signature


class TestExactEvmPayloadV1V2:
    """Test ExactEvmPayloadV1 and ExactEvmPayloadV2 type aliases."""

    def test_v1_should_be_alias_of_eip3009_payload(self):
        """V1 should be alias of ExactEIP3009Payload."""
        assert ExactEvmPayloadV1 is ExactEIP3009Payload

    def test_v2_should_accept_eip3009_payload(self):
        """V2 should include EIP-3009 payload support."""
        assert isinstance(ExactEIP3009Payload, type)

    def test_v2_should_include_permit2_payload(self):
        """V2 should also include Permit2 payload support."""
        args = getattr(ExactEvmPayloadV2, "__args__", ())
        assert ExactEIP3009Payload in args
        assert ExactPermit2Payload in args


class TestExactPermit2Payload:
    """Test ExactPermit2Payload type."""

    def test_round_trip_serialization(self):
        """Should preserve Permit2 payload data through serialization."""
        payload = ExactPermit2Payload(
            permit2_authorization=ExactPermit2Authorization(
                from_address="0x1234567890123456789012345678901234567890",
                permitted_token="0x337610d27c682E347C9cD60BD4b3b107C9d34dDd",
                permitted_amount="1000000000000000000",
                spender="0xEe38Ec718255fe78e9D16aCC0e1183C731679b23",
                nonce="0x" + "12" * 32,
                deadline="1000003600",
                witness=Permit2Witness(
                    to="0x0987654321098765432109876543210987654321",
                    facilitator="0x1111111111111111111111111111111111111111",
                    valid_after="1000000000",
                ),
            ),
            signature="0xabcd",
        )

        serialized = payload.to_dict()
        restored = ExactPermit2Payload.from_dict(serialized)

        assert restored.permit2_authorization.from_address == (
            payload.permit2_authorization.from_address
        )
        assert restored.permit2_authorization.witness.facilitator == (
            payload.permit2_authorization.witness.facilitator
        )
        assert restored.signature == payload.signature
