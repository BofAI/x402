"""Utility helpers for the ERC-20 Approval Gas Sponsoring Extension."""

from typing import Any

from .types import (
    ERC20_APPROVAL_GAS_SPONSORING,
    ERC20_APPROVAL_GAS_SPONSORING_VERSION,
    Erc20ApprovalGasSponsoringInfo,
)


def declare_erc20_approval_gas_sponsoring_extension(
    description: str = "ERC-20 approval gas sponsoring",
) -> dict:
    return {
        ERC20_APPROVAL_GAS_SPONSORING.key: {
            "info": {"description": description, "version": ERC20_APPROVAL_GAS_SPONSORING_VERSION},
            "schema": {},
        }
    }


def extract_erc20_approval_gas_sponsoring_info(
    payment_payload_extensions: dict[str, Any] | None,
) -> Erc20ApprovalGasSponsoringInfo | None:
    if not payment_payload_extensions:
        return None
    raw = payment_payload_extensions.get(ERC20_APPROVAL_GAS_SPONSORING.key)
    if not isinstance(raw, dict):
        return None
    info = raw.get("info")
    if not isinstance(info, dict):
        return None
    return Erc20ApprovalGasSponsoringInfo.from_dict(info)


def validate_erc20_approval_gas_sponsoring_info(info: Erc20ApprovalGasSponsoringInfo) -> bool:
    required = [
        info.from_address,
        info.asset,
        info.spender,
        info.amount,
        info.signed_transaction,
        info.version,
    ]
    return all(bool(v) for v in required)
