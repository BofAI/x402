"""
Payment ID generation utilities for x402 protocol.

Payment IDs are 16-byte identifiers used to track payments.
They are represented as hex strings with '0x' prefix for consistency.
"""

import secrets


def generate_payment_id() -> str:
    """
    Generate a random payment ID in hex format.

    Returns:
        A 16-byte payment ID as a hex string with '0x' prefix.
        Example: "0x1234567890abcdef1234567890abcdef"
    """
    return "0x" + secrets.token_hex(16)
