"""Tests for payment ID generation utilities"""

from bankofai.x402.utils import generate_payment_id


def test_generate_payment_id_format():
    """Test that generated payment ID has correct format"""
    payment_id = generate_payment_id()

    # Should start with 0x
    assert payment_id.startswith("0x")

    # Should be 34 characters total (0x + 32 hex chars)
    assert len(payment_id) == 34

    # Should be valid hex
    bytes.fromhex(payment_id[2:])


def test_generate_payment_id_uniqueness():
    """Test that generated payment IDs are unique"""
    ids = [generate_payment_id() for _ in range(100)]

    # All IDs should be unique
    assert len(set(ids)) == 100


def test_generate_payment_id_bytes_conversion():
    """Test that payment ID can be converted to bytes16"""
    payment_id = generate_payment_id()

    # Remove 0x prefix and convert to bytes
    payment_id_bytes = bytes.fromhex(payment_id[2:])

    # Should be exactly 16 bytes
    assert len(payment_id_bytes) == 16
