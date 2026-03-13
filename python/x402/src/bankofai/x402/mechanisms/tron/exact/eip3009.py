"""TRON eip3009 (TransferWithAuthorization) facilitator logic.

Mirrors the TypeScript verifyEIP3009() / settleEIP3009() functions.
"""

import time
from typing import Any

from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import (
    AUTHORIZATION_TYPES,
    ERR_INSUFFICIENT_FUNDS,
    ERR_INVALID_SCHEME,
    ERR_INVALID_SIGNATURE,
    ERR_INVALID_TRANSACTION_STATE,
    ERR_MISSING_TIP712_DOMAIN,
    ERR_NETWORK_MISMATCH,
    ERR_RECIPIENT_MISMATCH,
    ERR_TRANSACTION_FAILED,
    ERR_VALID_AFTER_FUTURE,
    ERR_VALID_BEFORE_EXPIRED,
    ERR_VALUE_MISMATCH,
    SCHEME_EXACT,
)
from ..signers import FacilitatorTronSigner
from ..utils import get_tron_chain_id, normalize_address_for_signing


def verify_eip3009(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    raw: dict[str, Any],
) -> VerifyResponse:
    """Verify a TIP-712 TransferWithAuthorization payment payload.

    Mirrors the TypeScript verifyEIP3009() function exactly.
    """
    auth = raw.get("authorization", {})
    payer = auth.get("from", "")

    # Scheme check
    if payload.accepted.scheme != SCHEME_EXACT or requirements.scheme != SCHEME_EXACT:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SCHEME, payer=payer)

    # TIP-712 domain params
    extra = requirements.extra or {}
    if "name" not in extra or "version" not in extra:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_MISSING_TIP712_DOMAIN, payer=payer)

    # Network match
    if str(payload.accepted.network) != str(requirements.network):
        return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

    # Build TIP-712 domain and message
    try:
        chain_id = get_tron_chain_id(str(requirements.network))
    except ValueError:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

    token_address = normalize_address_for_signing(requirements.asset)
    domain = {
        "name": extra["name"],
        "version": extra["version"],
        "chainId": chain_id,
        "verifyingContract": token_address,
    }
    nonce_hex = str(auth.get("nonce", "0x" + "00" * 32))
    message = {
        "from": normalize_address_for_signing(str(auth.get("from", ""))),
        "to": normalize_address_for_signing(str(auth.get("to", ""))),
        "value": int(str(auth.get("value", 0))),
        "validAfter": int(str(auth.get("validAfter", 0))),
        "validBefore": int(str(auth.get("validBefore", 0))),
        "nonce": bytes.fromhex(nonce_hex.removeprefix("0x")),  # bytes32
    }

    signature = str(raw.get("signature", ""))
    is_valid = signer.verify_typed_data(
        address=auth.get("from", ""),
        domain=domain,
        types=AUTHORIZATION_TYPES,
        primary_type="TransferWithAuthorization",
        message=message,
        signature=signature,
    )
    if not is_valid:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SIGNATURE, payer=payer)

    # Recipient check
    if normalize_address_for_signing(auth.get("to", "")) != normalize_address_for_signing(
        requirements.pay_to
    ):
        return VerifyResponse(is_valid=False, invalid_reason=ERR_RECIPIENT_MISMATCH, payer=payer)

    # Timing check
    now = int(time.time())
    if int(auth.get("validBefore", 0)) < now + 6:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_VALID_BEFORE_EXPIRED, payer=payer)
    if int(auth.get("validAfter", 0)) > now:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_VALID_AFTER_FUTURE, payer=payer)

    # Amount check
    if int(auth.get("value", 0)) != int(requirements.amount):
        return VerifyResponse(is_valid=False, invalid_reason=ERR_VALUE_MISMATCH, payer=payer)

    # Balance check (best-effort)
    try:
        balance = signer.read_contract(
            address=requirements.asset,
            function_name="balanceOf",
            args=[auth.get("from", "")],
        )
        if int(str(balance)) < int(str(requirements.amount)):
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_INSUFFICIENT_FUNDS,
                invalid_message=f"Insufficient funds. Required: {requirements.amount}, Available: {balance}",
                payer=payer,
            )
    except Exception:
        pass

    return VerifyResponse(is_valid=True, payer=payer)


def settle_eip3009(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    raw: dict[str, Any],
) -> SettleResponse:
    """Settle a TIP-712 TransferWithAuthorization payment on-chain.

    Mirrors the TypeScript settleEIP3009() function.
    """
    auth = raw.get("authorization", {})
    payer = auth.get("from", "")
    network = str(requirements.network)

    # Re-verify
    verify_result = verify_eip3009(signer, payload, requirements, raw)
    if not verify_result.is_valid:
        return SettleResponse(
            success=False,
            error_reason=verify_result.invalid_reason or ERR_INVALID_SCHEME,
            transaction="",
            network=network,
            payer=payer,
        )

    # Parse signature into v, r, s
    clean_sig = str(raw.get("signature", "")).removeprefix("0x")
    r = bytes.fromhex(clean_sig[:64])  # bytes32
    s = bytes.fromhex(clean_sig[64:128])  # bytes32
    v = int(clean_sig[128:130], 16)  # uint8
    nonce_bytes = bytes.fromhex(str(auth.get("nonce", "0x" + "00" * 32)).removeprefix("0x"))

    try:
        tx = signer.write_contract(
            address=requirements.asset,
            function_name="transferWithAuthorization",
            args=[
                str(auth.get("from", "")),
                str(auth.get("to", "")),
                int(str(auth.get("value", 0))),
                int(str(auth.get("validAfter", 0))),
                int(str(auth.get("validBefore", 0))),
                nonce_bytes,
                v,
                r,
                s,
            ],
            fee_limit=1_000_000_000,
        )

        receipt = signer.wait_for_transaction_receipt(tx)
        if receipt.status != "success":
            return SettleResponse(
                success=False,
                error_reason=ERR_INVALID_TRANSACTION_STATE,
                transaction=tx,
                network=network,
                payer=payer,
            )
        return SettleResponse(success=True, transaction=tx, network=network, payer=payer)

    except Exception as e:
        return SettleResponse(
            success=False,
            error_reason=ERR_TRANSACTION_FAILED,
            error_message=str(e),
            transaction="",
            network=network,
            payer=payer,
        )
