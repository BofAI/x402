"""EVM Permit2 verification and settlement helpers."""

from __future__ import annotations

import time
from typing import Any

from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import (
    ERC20_ALLOWANCE_ABI,
    ERR_INVALID_PERMIT2_FACILITATOR,
    ERR_INVALID_PERMIT2_SPENDER,
    ERR_MISSING_PERMIT2_ADDRESS,
    ERR_PERMIT2_ALLOWANCE_REQUIRED,
    ERR_PERMIT2_AMOUNT_MISMATCH,
    ERR_PERMIT2_DEADLINE_EXPIRED,
    ERR_PERMIT2_INVALID_SIGNATURE,
    ERR_PERMIT2_NOT_YET_VALID,
    ERR_PERMIT2_RECIPIENT_MISMATCH,
    ERR_PERMIT2_TOKEN_MISMATCH,
    ERR_TRANSACTION_FAILED,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    TX_STATUS_SUCCESS,
    X402_EXACT_PERMIT2_PROXY_ABI,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signer import FacilitatorEvmSigner
from ..types import ExactPermit2Payload, TypedDataDomain, TypedDataField
from ..utils import get_evm_chain_id, normalize_address


def verify_permit2(
    signer: FacilitatorEvmSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    raw: dict[str, Any],
) -> VerifyResponse:
    """Verify a Permit2 exact payment payload."""
    permit2_payload = ExactPermit2Payload.from_dict(raw)
    payer = permit2_payload.permit2_authorization.from_address
    network = str(requirements.network)

    permit2_address = PERMIT2_ADDRESSES.get(network)
    proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
    if not permit2_address or not proxy_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_MISSING_PERMIT2_ADDRESS, payer=payer
        )

    if normalize_address(permit2_payload.permit2_authorization.spender) != normalize_address(
        proxy_address
    ):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_SPENDER, payer=payer
        )

    if normalize_address(permit2_payload.permit2_authorization.witness.to) != normalize_address(
        requirements.pay_to
    ):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_RECIPIENT_MISMATCH, payer=payer
        )

    facilitator_address = (requirements.extra or {}).get("permit2FacilitatorAddress")
    if not facilitator_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_FACILITATOR, payer=payer
        )
    if normalize_address(
        permit2_payload.permit2_authorization.witness.facilitator
    ) != normalize_address(str(facilitator_address)):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_FACILITATOR, payer=payer
        )

    now = int(time.time())
    if int(permit2_payload.permit2_authorization.deadline) < now + 6:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_DEADLINE_EXPIRED, payer=payer
        )
    if int(permit2_payload.permit2_authorization.witness.valid_after) > now:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_NOT_YET_VALID, payer=payer)
    if int(permit2_payload.permit2_authorization.permitted_amount) != int(requirements.amount):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_AMOUNT_MISMATCH, payer=payer
        )
    if normalize_address(
        permit2_payload.permit2_authorization.permitted_token
    ) != normalize_address(requirements.asset):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_TOKEN_MISMATCH, payer=payer
        )

    typed_fields = _permit2_typed_fields()
    domain = TypedDataDomain(
        name="Permit2",
        version="1",
        chain_id=get_evm_chain_id(network),
        verifying_contract=normalize_address(permit2_address),
    )
    message = {
        "permitted": {
            "token": normalize_address(permit2_payload.permit2_authorization.permitted_token),
            "amount": int(permit2_payload.permit2_authorization.permitted_amount),
        },
        "spender": normalize_address(permit2_payload.permit2_authorization.spender),
        "nonce": int(str(permit2_payload.permit2_authorization.nonce), 0),
        "deadline": int(permit2_payload.permit2_authorization.deadline),
        "witness": {
            "to": normalize_address(permit2_payload.permit2_authorization.witness.to),
            "facilitator": normalize_address(
                permit2_payload.permit2_authorization.witness.facilitator
            ),
            "validAfter": int(permit2_payload.permit2_authorization.witness.valid_after),
        },
    }

    is_valid = signer.verify_typed_data(
        payer,
        domain,
        typed_fields,
        "PermitWitnessTransferFrom",
        message,
        bytes.fromhex(permit2_payload.signature.removeprefix("0x")),
    )
    if not is_valid:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
        )

    try:
        allowance = signer.read_contract(
            normalize_address(requirements.asset),
            ERC20_ALLOWANCE_ABI,
            "allowance",
            normalize_address(payer),
            normalize_address(permit2_address),
        )
        if int(allowance) < int(requirements.amount):
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
            )
    except Exception:
        pass

    return VerifyResponse(is_valid=True, payer=payer)


def settle_permit2(
    signer: FacilitatorEvmSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    raw: dict[str, Any],
) -> SettleResponse:
    """Settle a Permit2 exact payment on-chain."""
    verify = verify_permit2(signer, payload, requirements, raw)
    if not verify.is_valid:
        return SettleResponse(
            success=False,
            error_reason=verify.invalid_reason,
            network=str(payload.accepted.network),
            payer=verify.payer,
            transaction="",
        )

    permit2_payload = ExactPermit2Payload.from_dict(raw)
    network = str(requirements.network)
    proxy_address = X402_PERMIT2_PROXY_ADDRESSES[network]

    permit = (
        (
            normalize_address(permit2_payload.permit2_authorization.permitted_token),
            int(permit2_payload.permit2_authorization.permitted_amount),
        ),
        int(str(permit2_payload.permit2_authorization.nonce), 0),
        int(permit2_payload.permit2_authorization.deadline),
    )
    witness = (
        normalize_address(permit2_payload.permit2_authorization.witness.to),
        normalize_address(permit2_payload.permit2_authorization.witness.facilitator),
        int(permit2_payload.permit2_authorization.witness.valid_after),
    )

    try:
        tx_hash = signer.write_contract(
            normalize_address(proxy_address),
            X402_EXACT_PERMIT2_PROXY_ABI,
            "settle",
            permit,
            normalize_address(permit2_payload.permit2_authorization.from_address),
            witness,
            bytes.fromhex(permit2_payload.signature.removeprefix("0x")),
        )
        receipt = signer.wait_for_transaction_receipt(tx_hash)
        if receipt.status != TX_STATUS_SUCCESS:
            return SettleResponse(
                success=False,
                error_reason=ERR_TRANSACTION_FAILED,
                transaction=tx_hash,
                network=network,
                payer=permit2_payload.permit2_authorization.from_address,
            )
        return SettleResponse(
            success=True,
            transaction=tx_hash,
            network=network,
            payer=permit2_payload.permit2_authorization.from_address,
        )
    except Exception as e:
        return SettleResponse(
            success=False,
            error_reason=ERR_TRANSACTION_FAILED,
            error_message=str(e),
            transaction="",
            network=network,
            payer=permit2_payload.permit2_authorization.from_address,
        )


def _permit2_typed_fields() -> dict[str, list[TypedDataField]]:
    """Convert Permit2 type descriptors to signer fields."""
    typed_fields: dict[str, list[TypedDataField]] = {}
    for type_name, fields in PERMIT2_WITNESS_TYPES.items():
        typed_fields[type_name] = [
            TypedDataField(name=field["name"], type=field["type"]) for field in fields
        ]
    return typed_fields
