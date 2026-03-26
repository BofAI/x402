"""Utility helpers for the EIP-2612 Gas Sponsoring Extension."""

from typing import Any

from .types import EIP2612_GAS_SPONSORING, Eip2612GasSponsoringInfo


def declare_eip2612_gas_sponsoring_extension(description: str = "EIP-2612 gas sponsoring") -> dict:
    """Declare the EIP-2612 gas sponsoring extension in PaymentRequired."""
    return {
        EIP2612_GAS_SPONSORING.key: {
            "info": {"description": description, "version": "1"},
            "schema": {},
        }
    }


def extract_eip2612_gas_sponsoring_info(
    payment_payload_extensions: dict[str, Any] | None,
) -> Eip2612GasSponsoringInfo | None:
    if not payment_payload_extensions:
        return None
    raw = payment_payload_extensions.get(EIP2612_GAS_SPONSORING.key)
    if not isinstance(raw, dict):
        return None
    info = raw.get("info")
    if not isinstance(info, dict):
        return None
    return Eip2612GasSponsoringInfo.from_dict(info)


def validate_eip2612_gas_sponsoring_info(info: Eip2612GasSponsoringInfo) -> bool:
    required = [
        info.from_address,
        info.asset,
        info.spender,
        info.amount,
        info.nonce,
        info.deadline,
        info.signature,
        info.version,
    ]
    return all(bool(v) for v in required)
