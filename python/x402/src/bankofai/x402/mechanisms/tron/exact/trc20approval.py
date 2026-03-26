"""TRON client helper for sponsored TRC-20 Permit2 approvals."""

from __future__ import annotations

from typing import Any

from ....extensions.trc20_approval_gas_sponsoring import (
    TRC20_APPROVAL_GAS_SPONSORING_VERSION,
)
from ..constants import DEFAULT_FEE_LIMIT_SUN, PERMIT2_ADDRESSES

MAX_UINT256 = (1 << 256) - 1


def sign_trc20_approval_transaction(
    signer: Any, token_address: str, network: str
) -> dict[str, Any]:
    if not hasattr(signer, "build_trigger_smart_contract_transaction") or not hasattr(
        signer, "sign_transaction"
    ):
        raise ValueError("TRON signer does not support approval transaction signing")

    spender = PERMIT2_ADDRESSES.get(network)
    if not spender:
        raise ValueError(f"No Permit2 contract address configured for network {network}")

    unsigned_tx = signer.build_trigger_smart_contract_transaction(
        contract_address=token_address,
        function_selector="approve(address,uint256)",
        parameters=[
            {"type": "address", "value": spender},
            {"type": "uint256", "value": MAX_UINT256},
        ],
        fee_limit=DEFAULT_FEE_LIMIT_SUN,
        call_value=0,
        owner_address=signer.address,
    )

    signed_tx = signer.sign_transaction(unsigned_tx)
    signatures = signed_tx.get("signature") if isinstance(signed_tx, dict) else None
    if not signatures:
        raise ValueError("Failed to sign TRON approval transaction")

    return {
        "from": signer.address,
        "asset": token_address,
        "spender": spender,
        "amount": str(MAX_UINT256),
        "signedTransaction": signed_tx,
        "version": TRC20_APPROVAL_GAS_SPONSORING_VERSION,
    }
