"""
EIP-712 message conversion utilities for x402 protocol.

Provides common functions for converting PaymentPermit to EIP-712 compatible format.
"""

from typing import Any

from bankofai.x402.types import KIND_MAP, PaymentPermit

# Zero addresses for different networks
EVM_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
TRON_ZERO_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"


def payment_id_to_bytes(payment_id: str) -> bytes:
    """
    Convert payment ID from hex string to bytes16.

    Args:
        payment_id: Hex string with 0x prefix (e.g., "0x1234...abcd")

    Returns:
        16-byte payment ID

    Raises:
        ValueError: If format is invalid
    """
    if not payment_id.startswith("0x"):
        raise ValueError(
            f"Invalid payment ID format: {payment_id}. Expected hex string with 0x prefix"
        )

    payment_id_hex = payment_id[2:]
    if len(payment_id_hex) != 32:
        raise ValueError(
            f"Invalid payment ID length: {len(payment_id_hex)}. Expected 32 hex characters"
        )

    return bytes.fromhex(payment_id_hex)


def convert_permit_to_eip712_message(permit: PaymentPermit) -> dict[str, Any]:
    """
    Convert PaymentPermit to EIP-712 compatible message dict.

    Converts string values to integers and paymentId to bytes as required by EIP-712.

    Args:
        permit: PaymentPermit instance

    Returns:
        Dict with EIP-712 compatible types
    """
    message = permit.model_dump(by_alias=True)

    # Convert kind string to numeric value
    message["meta"]["kind"] = KIND_MAP.get(message["meta"]["kind"], 0)

    # Convert string values to integers for EIP-712 compatibility
    message["meta"]["nonce"] = int(message["meta"]["nonce"])
    message["payment"]["payAmount"] = int(message["payment"]["payAmount"])
    message["fee"]["feeAmount"] = int(message["fee"]["feeAmount"])

    # Convert paymentId from hex string to bytes16
    message["meta"]["paymentId"] = payment_id_to_bytes(message["meta"]["paymentId"])

    return message


def convert_tron_addresses_to_evm(message: dict[str, Any], tron_to_evm_fn) -> dict[str, Any]:
    """
    Convert TRON addresses in message to EVM format for EIP-712 compatibility.

    Args:
        message: EIP-712 message dict
        tron_to_evm_fn: Function to convert TRON address to EVM format

    Returns:
        Message with converted addresses
    """
    message["buyer"] = tron_to_evm_fn(message["buyer"])
    message["caller"] = tron_to_evm_fn(message["caller"])
    message["payment"]["payToken"] = tron_to_evm_fn(message["payment"]["payToken"])
    message["payment"]["payTo"] = tron_to_evm_fn(message["payment"]["payTo"])
    message["fee"]["feeTo"] = tron_to_evm_fn(message["fee"]["feeTo"])

    return message
