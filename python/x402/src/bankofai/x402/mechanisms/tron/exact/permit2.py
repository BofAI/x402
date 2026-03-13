"""TRON Permit2 facilitator logic: verify and settle Permit2 payments.

Mirrors the TypeScript verifyPermit2() / settlePermit2() functions exactly.
"""

import time

from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import (
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    X402_PERMIT2_PROXY_ADDRESSES,
    ERR_INVALID_SCHEME,
    ERR_NETWORK_MISMATCH,
    ERR_MISSING_PERMIT2_ADDRESS,
    ERR_INVALID_PERMIT2_SPENDER,
    ERR_PERMIT2_RECIPIENT_MISMATCH,
    ERR_INVALID_PERMIT2_FACILITATOR,
    ERR_PERMIT2_DEADLINE_EXPIRED,
    ERR_PERMIT2_NOT_YET_VALID,
    ERR_PERMIT2_AMOUNT_MISMATCH,
    ERR_PERMIT2_TOKEN_MISMATCH,
    ERR_PERMIT2_INVALID_SIGNATURE,
    ERR_PERMIT2_ALLOWANCE_REQUIRED,
    ERR_INSUFFICIENT_FUNDS,
    ERR_TRANSACTION_FAILED,
    ERR_INVALID_TRANSACTION_STATE,
)
from ..signers import FacilitatorTronSigner
from ..utils import get_tron_chain_id, normalize_address_for_signing


def verify_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: dict,
) -> VerifyResponse:
    """Verify a Permit2 payment payload on TRON.

    Mirrors the TS verifyPermit2() function.
    """
    auth = permit2_payload.get("permit2Authorization", {})
    payer = auth.get("from", "")
    facilitator_addresses = [normalize_address_for_signing(a) for a in signer.get_addresses()]

    network = str(requirements.network)

    # Scheme check
    if payload.accepted.scheme != "exact" or requirements.scheme != "exact":
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SCHEME, payer=payer)

    # Network match
    if str(payload.accepted.network) != network:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

    # Permit2 contract addresses
    permit2_address = PERMIT2_ADDRESSES.get(network)
    proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
    if not permit2_address or not proxy_address:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_MISSING_PERMIT2_ADDRESS, payer=payer)

    normalized_proxy = normalize_address_for_signing(proxy_address)
    token_address = normalize_address_for_signing(requirements.asset)

    # Spender must be x402Permit2Proxy
    spender = normalize_address_for_signing(auth.get("spender", ""))
    if spender != normalized_proxy:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_SPENDER, payer=payer)

    # Recipient check
    witness = auth.get("witness", {})
    payload_to = normalize_address_for_signing(witness.get("to", ""))
    required_to = normalize_address_for_signing(requirements.pay_to)
    if payload_to != required_to:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_RECIPIENT_MISMATCH, payer=payer)

    # Facilitator check
    payload_facilitator = normalize_address_for_signing(witness.get("facilitator", ""))
    if payload_facilitator not in facilitator_addresses:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_FACILITATOR, payer=payer)

    # Timing checks
    now = int(time.time())
    if int(auth.get("deadline", 0)) < now + 6:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_DEADLINE_EXPIRED, payer=payer)
    if int(witness.get("validAfter", 0)) > now:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_NOT_YET_VALID, payer=payer)

    # Amount check
    permitted = auth.get("permitted", {})
    if int(permitted.get("amount", 0)) != int(requirements.amount):
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_AMOUNT_MISMATCH, payer=payer)

    # Token check
    if normalize_address_for_signing(permitted.get("token", "")) != token_address:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_TOKEN_MISMATCH, payer=payer)

    # Signature verification
    try:
        chain_id = get_tron_chain_id(network)
        normalized_permit2 = normalize_address_for_signing(permit2_address)
        domain = {"name": "Permit2", "chainId": chain_id, "verifyingContract": normalized_permit2}
        message = {
            "permitted": {
                "token": permitted.get("token", ""),
                "amount": int(permitted.get("amount", 0)),
            },
            "spender": auth.get("spender", ""),
            "nonce": int(auth.get("nonce", 0)),
            "deadline": int(auth.get("deadline", 0)),
            "witness": {
                "to": witness.get("to", ""),
                "facilitator": witness.get("facilitator", ""),
                "validAfter": int(witness.get("validAfter", 0)),
            },
        }
        is_valid = signer.verify_typed_data(
            address=payer,
            domain=domain,
            types=PERMIT2_WITNESS_TYPES,
            primary_type="PermitWitnessTransferFrom",
            message=message,
            signature=permit2_payload.get("signature", ""),
        )
        if not is_valid:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer)
    except Exception:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer)

    # Allowance check (best-effort)
    try:
        allowance = signer.read_contract(
            address=requirements.asset,
            function_name="allowance",
            args=[payer, permit2_address],
        )
        if int(allowance) < int(requirements.amount):
            return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer)
    except Exception:
        pass

    # Balance check (best-effort)
    try:
        balance = signer.read_contract(
            address=requirements.asset,
            function_name="balanceOf",
            args=[payer],
        )
        if int(balance) < int(requirements.amount):
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_INSUFFICIENT_FUNDS,
                invalid_message=f"Insufficient funds. Required: {requirements.amount}, Available: {balance}",
                payer=payer,
            )
    except Exception:
        pass

    return VerifyResponse(is_valid=True, payer=payer)


def settle_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: dict,
) -> SettleResponse:
    """Settle a Permit2 payment on TRON via x402Permit2Proxy.settle().

    Mirrors the TS settlePermit2() function.
    """
    auth = permit2_payload.get("permit2Authorization", {})
    payer = auth.get("from", "")
    network = str(requirements.network)

    # Re-verify
    verify_result = verify_permit2(signer, payload, requirements, permit2_payload)
    if not verify_result.is_valid:
        return SettleResponse(
            success=False,
            error_reason=verify_result.invalid_reason or ERR_INVALID_SCHEME,
            transaction="",
            network=network,
            payer=payer,
        )

    proxy_address = X402_PERMIT2_PROXY_ADDRESSES[network]
    permitted = auth.get("permitted", {})
    witness = auth.get("witness", {})

    # Build tuple args as per x402ExactPermit2ProxyABI
    permit_tuple = [
        [permitted.get("token", ""), int(permitted.get("amount", 0))],  # permitted (token, amount)
        int(auth.get("nonce", 0)),   # nonce
        int(auth.get("deadline", 0)),  # deadline
    ]
    witness_tuple = [
        witness.get("to", ""),
        witness.get("facilitator", ""),
        int(witness.get("validAfter", 0)),
    ]
    signature_bytes = bytes.fromhex(permit2_payload.get("signature", "").removeprefix("0x"))

    try:
        tx = signer.write_contract(
            address=proxy_address,
            function_name="settle",
            args=[permit_tuple, payer, witness_tuple, signature_bytes],
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
