"""TRON Permit2 facilitator logic: verify and settle Permit2 payments."""

import time
from typing import Any

from ....extensions.trc20_approval_gas_sponsoring import (
    TRC20_APPROVAL_GAS_SPONSORING,
    Trc20ApprovalGasSponsoringExtension,
    extract_trc20_approval_gas_sponsoring_info,
    validate_trc20_approval_gas_sponsoring_info,
)
from ....interfaces import FacilitatorContext
from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import (
    ERR_INSUFFICIENT_FUNDS,
    ERR_INVALID_PERMIT2_FACILITATOR,
    ERR_INVALID_PERMIT2_SPENDER,
    ERR_INVALID_SCHEME,
    ERR_INVALID_TRANSACTION_STATE,
    ERR_MISSING_PERMIT2_ADDRESS,
    ERR_NETWORK_MISMATCH,
    ERR_PERMIT2_ALLOWANCE_REQUIRED,
    ERR_PERMIT2_AMOUNT_MISMATCH,
    ERR_PERMIT2_DEADLINE_EXPIRED,
    ERR_PERMIT2_INVALID_SIGNATURE,
    ERR_PERMIT2_NOT_YET_VALID,
    ERR_PERMIT2_RECIPIENT_MISMATCH,
    ERR_PERMIT2_TOKEN_MISMATCH,
    ERR_TRANSACTION_FAILED,
    ERR_TRC20_APPROVAL_ASSET_MISMATCH,
    ERR_TRC20_APPROVAL_FORMAT,
    ERR_TRC20_APPROVAL_FROM_MISMATCH,
    ERR_TRC20_APPROVAL_SPENDER_NOT_PERMIT2,
    ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
    ERR_TRC20_APPROVAL_TX_MISSING_DATA,
    ERR_TRC20_APPROVAL_TX_WRONG_AMOUNT,
    ERR_TRC20_APPROVAL_TX_WRONG_SELECTOR,
    ERR_TRC20_APPROVAL_TX_WRONG_SPENDER,
    ERR_TRC20_APPROVAL_TX_WRONG_TARGET,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signer import FacilitatorTronSigner
from ..types import ExactPermit2Payload
from ..utils import (
    get_tron_chain_id,
    normalize_address_for_contract_call,
    normalize_address_for_signing,
)


def verify_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: ExactPermit2Payload,
    context: FacilitatorContext | None = None,
) -> VerifyResponse:
    """Verify a Permit2 payment payload on TRON."""
    auth = permit2_payload.permit2_authorization
    payer = auth.from_address
    facilitator_addresses = [normalize_address_for_signing(a) for a in signer.get_addresses()]

    network = str(requirements.network)

    if payload.accepted.scheme != "exact" or requirements.scheme != "exact":
        return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SCHEME, payer=payer)

    if str(payload.accepted.network) != network:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

    permit2_address = PERMIT2_ADDRESSES.get(network)
    proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
    if not permit2_address or not proxy_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_MISSING_PERMIT2_ADDRESS, payer=payer
        )

    normalized_proxy = normalize_address_for_signing(proxy_address)
    token_address = normalize_address_for_signing(requirements.asset)

    if normalize_address_for_signing(auth.spender) != normalized_proxy:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_SPENDER, payer=payer
        )

    payload_to = normalize_address_for_signing(auth.witness.to)
    required_to = normalize_address_for_signing(requirements.pay_to)
    if payload_to != required_to:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_RECIPIENT_MISMATCH, payer=payer
        )

    payload_facilitator = normalize_address_for_signing(auth.witness.facilitator)
    if payload_facilitator not in facilitator_addresses:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_FACILITATOR, payer=payer
        )

    now = int(time.time())
    if int(auth.deadline) < now + 6:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_DEADLINE_EXPIRED, payer=payer
        )
    if int(auth.witness.valid_after) > now:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_NOT_YET_VALID, payer=payer
        )

    if int(auth.permitted_amount) != int(requirements.amount):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_AMOUNT_MISMATCH, payer=payer
        )

    if normalize_address_for_signing(auth.permitted_token) != token_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_TOKEN_MISMATCH, payer=payer
        )

    try:
        chain_id = get_tron_chain_id(network)
        normalized_permit2 = normalize_address_for_signing(permit2_address)
        domain = {"name": "Permit2", "chainId": chain_id, "verifyingContract": normalized_permit2}
        message = {
            "permitted": {
                "token": auth.permitted_token,
                "amount": int(auth.permitted_amount),
            },
            "spender": auth.spender,
            "nonce": int(auth.nonce, 0),
            "deadline": int(auth.deadline),
            "witness": {
                "to": auth.witness.to,
                "facilitator": auth.witness.facilitator,
                "validAfter": int(auth.witness.valid_after),
            },
        }
        is_valid = signer.verify_typed_data(
            address=payer,
            domain=domain,
            types=PERMIT2_WITNESS_TYPES,
            primary_type="PermitWitnessTransferFrom",
            message=message,
            signature=permit2_payload.signature,
        )
        if not is_valid:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
            )
    except Exception:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
        )

    try:
        payer_for_contract = normalize_address_for_contract_call(payer)
        permit2_for_contract = normalize_address_for_contract_call(permit2_address)
        allowance = signer.read_contract(
            address=requirements.asset,
            function_name="allowance",
            args=[payer_for_contract, permit2_for_contract],
        )
        if int(str(allowance)) < int(str(requirements.amount)):
            has_extension, extension_error = _verify_trc20_approval_extension(
                signer, payload, requirements, payer, permit2_address, context
            )
            if extension_error is not None:
                return extension_error
            if not has_extension:
                return VerifyResponse(
                    is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
                )
    except Exception:
        has_extension, extension_error = _verify_trc20_approval_extension(
            signer, payload, requirements, payer, permit2_address, context
        )
        if extension_error is not None:
            return extension_error

    try:
        payer_for_contract = normalize_address_for_contract_call(payer)
        balance = signer.read_contract(
            address=requirements.asset,
            function_name="balanceOf",
            args=[payer_for_contract],
        )
        if int(str(balance)) < int(str(requirements.amount)):
            return VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_INSUFFICIENT_FUNDS,
                invalid_message=(
                    f"Insufficient funds. Required: {requirements.amount}, Available: {balance}"
                ),
                payer=payer,
            )
    except Exception:
        pass

    return VerifyResponse(is_valid=True, payer=payer)


def settle_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: ExactPermit2Payload,
    context: FacilitatorContext | None = None,
) -> SettleResponse:
    """Settle a Permit2 payment on TRON via x402Permit2Proxy.settle()."""
    auth = permit2_payload.permit2_authorization
    payer = auth.from_address
    network = str(requirements.network)

    verify_result = verify_permit2(signer, payload, requirements, permit2_payload, context)
    if not verify_result.is_valid:
        return SettleResponse(
            success=False,
            error_reason=verify_result.invalid_reason or ERR_INVALID_SCHEME,
            transaction="",
            network=network,
            payer=payer,
        )

    proxy_address = X402_PERMIT2_PROXY_ADDRESSES[network]

    trc20_info = extract_trc20_approval_gas_sponsoring_info(payload.extensions)
    if trc20_info and context is not None:
        needs_approval = True
        try:
            permit2_address = PERMIT2_ADDRESSES.get(network)
            if permit2_address:
                payer_for_contract = normalize_address_for_contract_call(payer)
                permit2_for_contract = normalize_address_for_contract_call(permit2_address)
                allowance = signer.read_contract(
                    address=requirements.asset,
                    function_name="allowance",
                    args=[payer_for_contract, permit2_for_contract],
                )
                needs_approval = int(str(allowance)) < int(str(requirements.amount))
        except Exception:
            needs_approval = True

        if needs_approval:
            extension = context.get_extension(TRC20_APPROVAL_GAS_SPONSORING.key)
            if isinstance(extension, Trc20ApprovalGasSponsoringExtension) and extension.signer:
                settle_result = _settle_with_trc20_approval(
                    extension.signer, payload, requirements, permit2_payload, trc20_info
                )
                if settle_result is not None:
                    return settle_result
    try:
        from ..constants import x402ExactPermit2ProxyABI

        signature_hex = str(permit2_payload.signature)
        signature_bytes = bytes.fromhex(signature_hex.removeprefix("0x"))
        tx = signer.write_contract_with_abi(
            address=proxy_address,
            function_name="settle",
            args=[
                (
                    (
                        normalize_address_for_contract_call(auth.permitted_token),
                        int(str(auth.permitted_amount)),
                    ),
                    int(str(auth.nonce), 0),
                    int(str(auth.deadline)),
                ),
                normalize_address_for_contract_call(payer),
                (
                    normalize_address_for_contract_call(auth.witness.to),
                    normalize_address_for_contract_call(auth.witness.facilitator),
                    int(str(auth.witness.valid_after)),
                ),
                signature_bytes,
            ],
            abi=x402ExactPermit2ProxyABI,
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


def _verify_trc20_approval_extension(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    payer: str,
    permit2_address: str,
    context: FacilitatorContext | None,
) -> tuple[bool, VerifyResponse | None]:
    info = extract_trc20_approval_gas_sponsoring_info(payload.extensions)
    if not info:
        return False, None

    if context is None or context.get_extension(TRC20_APPROVAL_GAS_SPONSORING.key) is None:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
        )

    if not validate_trc20_approval_gas_sponsoring_info(info):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_FORMAT, payer=payer
        )

    if normalize_address_for_signing(info.from_address) != normalize_address_for_signing(payer):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_FROM_MISMATCH, payer=payer
        )

    if normalize_address_for_signing(info.asset) != normalize_address_for_signing(requirements.asset):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_ASSET_MISMATCH, payer=payer
        )

    if normalize_address_for_signing(info.spender) != normalize_address_for_signing(permit2_address):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_SPENDER_NOT_PERMIT2, payer=payer
        )

    tx = info.signed_transaction
    if not isinstance(tx, dict):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_MISSING_DATA, payer=payer
        )

    tx_value = _get_approval_transaction_value(tx)
    if not tx_value.get("owner_address") or not tx_value.get("contract_address") or not tx_value.get("data"):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_MISSING_DATA, payer=payer
        )

    if normalize_address_for_signing(tx_value["owner_address"]) != normalize_address_for_signing(payer):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_FROM_MISMATCH, payer=payer
        )

    if normalize_address_for_signing(tx_value["contract_address"]) != normalize_address_for_signing(
        requirements.asset
    ):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_WRONG_TARGET, payer=payer
        )

    data = str(tx_value["data"]).lower()
    if not data.startswith(_APPROVE_SELECTOR):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_WRONG_SELECTOR, payer=payer
        )

    decoded = _decode_approval_calldata(data)
    if not decoded:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_WRONG_SELECTOR, payer=payer
        )

    if normalize_address_for_signing(decoded["spender"]) != normalize_address_for_signing(
        permit2_address
    ):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_WRONG_SPENDER, payer=payer
        )

    if decoded["amount"] != _MAX_UINT256 or info.amount != str(_MAX_UINT256):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_WRONG_AMOUNT, payer=payer
        )

    try:
        sign_weight = signer.get_sign_weight(tx)
        if not _is_tron_signature_valid(sign_weight):
            return True, VerifyResponse(
                is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE, payer=payer
            )
    except Exception:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE, payer=payer
        )

    return True, None


def _settle_with_trc20_approval(
    signer: Any,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: ExactPermit2Payload,
    info: Any,
) -> SettleResponse | None:
    payer = permit2_payload.permit2_authorization.from_address
    network = str(requirements.network)
    try:
        tx_hash = signer.send_raw_transaction(info.signed_transaction)
        receipt = signer.wait_for_transaction_receipt(tx_hash)
        if receipt.status != "success":
            return SettleResponse(
                success=False,
                error_reason=ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
                transaction=tx_hash,
                network=network,
                payer=payer,
            )
    except Exception as e:
        return SettleResponse(
            success=False,
            error_reason=ERR_TRC20_APPROVAL_TX_INVALID_SIGNATURE,
            error_message=str(e),
            transaction="",
            network=network,
            payer=payer,
        )
    return None


_APPROVE_SELECTOR = "095ea7b3"
_MAX_UINT256 = (1 << 256) - 1


def _get_approval_transaction_value(tx: dict[str, Any]) -> dict[str, Any]:
    raw_data = tx.get("raw_data") or {}
    contract_list = raw_data.get("contract") or []
    contract = contract_list[0] if contract_list else {}
    parameter = contract.get("parameter") or {}
    value = parameter.get("value") or {}
    return {
        "owner_address": value.get("owner_address"),
        "contract_address": value.get("contract_address"),
        "data": value.get("data"),
    }


def _decode_approval_calldata(data: str) -> dict[str, Any] | None:
    cleaned = data.removeprefix("0x")
    if not cleaned.startswith(_APPROVE_SELECTOR):
        return None
    if len(cleaned) < 8 + 64 + 64:
        return None
    spender_word = cleaned[8 : 8 + 64]
    amount_word = cleaned[8 + 64 : 8 + 128]
    spender = "0x" + spender_word[24:].lower()
    amount = int(amount_word, 16)
    return {"spender": spender, "amount": amount}


def _is_tron_signature_valid(sign_weight: Any) -> bool:
    if not isinstance(sign_weight, dict):
        return False
    result = (
        sign_weight.get("transaction", {})
        .get("result", {})
        .get("result", sign_weight.get("result", {}).get("result"))
    )
    if isinstance(result, bool):
        return result
    current_weight = sign_weight.get("current_weight")
    threshold = (sign_weight.get("permission") or {}).get("threshold")
    if isinstance(current_weight, int) and isinstance(threshold, int):
        return current_weight >= threshold
    approved_list = sign_weight.get("approved_list")
    if isinstance(approved_list, list):
        return len(approved_list) > 0
    return False
