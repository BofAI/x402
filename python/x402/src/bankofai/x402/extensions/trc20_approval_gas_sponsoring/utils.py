"""Utility helpers for the TRC-20 Approval Gas Sponsoring Extension."""

from typing import Any

from .types import (
    TRC20_APPROVAL_GAS_SPONSORING,
    TRC20_APPROVAL_GAS_SPONSORING_VERSION,
    Trc20ApprovalGasSponsoringInfo,
)


def declare_trc20_approval_gas_sponsoring_extension(
    description: str = "TRC-20 approval gas sponsoring",
) -> dict:
    return {
        TRC20_APPROVAL_GAS_SPONSORING.key: {
            "info": {"description": description, "version": TRC20_APPROVAL_GAS_SPONSORING_VERSION},
            "schema": {},
        }
    }


def extract_trc20_approval_gas_sponsoring_info(
    payment_payload_extensions: dict[str, Any] | None,
) -> Trc20ApprovalGasSponsoringInfo | None:
    if not payment_payload_extensions:
        return None
    raw = payment_payload_extensions.get(TRC20_APPROVAL_GAS_SPONSORING.key)
    if not isinstance(raw, dict):
        return None
    info = raw.get("info")
    if not isinstance(info, dict):
        return None
    return Trc20ApprovalGasSponsoringInfo.from_dict(info)


def validate_trc20_approval_gas_sponsoring_info(info: Trc20ApprovalGasSponsoringInfo) -> bool:
    required = [
        info.from_address,
        info.asset,
        info.spender,
        info.amount,
        info.signed_transaction,
        info.version,
    ]
    return all(bool(v) for v in required)
