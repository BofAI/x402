"""
Encoding utilities for x402 protocol
"""

import base64
import json
from typing import Any, TypeVar

T = TypeVar("T")


def encode_base64(data: str | bytes) -> str:
    """Encode data to base64"""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return base64.b64encode(data).decode("utf-8")


def decode_base64(data: str) -> str:
    """Decode base64 to string"""
    return base64.b64decode(data).decode("utf-8")


def decode_base64_bytes(data: str) -> bytes:
    """Decode base64 to bytes"""
    return base64.b64decode(data)


def encode_payment_payload(payload: Any) -> str:
    """Encode payment payload to base64 for HTTP header"""
    if hasattr(payload, "model_dump"):
        json_str = json.dumps(payload.model_dump(by_alias=True))
    else:
        json_str = json.dumps(payload)
    return encode_base64(json_str)


def decode_payment_payload(encoded: str, model_class: type[T] | None = None) -> T | dict[str, Any]:
    """Decode payment payload from base64 HTTP header"""
    json_str = decode_base64(encoded)
    data = json.loads(json_str)
    if model_class is not None:
        return model_class(**data)
    return data


def bytes_to_hex(data: bytes, prefix: bool = True) -> str:
    """Convert bytes to hex string"""
    hex_str = data.hex()
    return f"0x{hex_str}" if prefix else hex_str


def hex_to_bytes(hex_str: str) -> bytes:
    """Convert hex string to bytes"""
    if hex_str.startswith("0x"):
        hex_str = hex_str[2:]
    return bytes.fromhex(hex_str)
