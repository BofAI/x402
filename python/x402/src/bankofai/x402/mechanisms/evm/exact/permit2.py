"""EVM Permit2 client + facilitator logic for the Exact payment scheme."""

from __future__ import annotations

import time
from typing import Any

from eth_account import Account
from eth_account.typed_transactions import TypedTransaction
from hexbytes import HexBytes

from ....extensions.eip2612_gas_sponsoring import (
    extract_eip2612_gas_sponsoring_info,
    validate_eip2612_gas_sponsoring_info,
)
from ....extensions.erc20_approval_gas_sponsoring import (
    ERC20_APPROVAL_GAS_SPONSORING,
    Erc20ApprovalGasSponsoringExtension,
    extract_erc20_approval_gas_sponsoring_info,
    validate_erc20_approval_gas_sponsoring_info,
)
from ....interfaces import FacilitatorContext
from ....schemas import PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse
from ..constants import (
    BALANCE_OF_ABI,
    ERC20_ALLOWANCE_ABI,
    ERR_EIP2612_ASSET_MISMATCH,
    ERR_EIP2612_DEADLINE_EXPIRED,
    ERR_EIP2612_EXTENSION_FORMAT,
    ERR_EIP2612_FROM_MISMATCH,
    ERR_EIP2612_SPENDER_NOT_PERMIT2,
    ERR_ERC20_APPROVAL_ASSET_MISMATCH,
    ERR_ERC20_APPROVAL_EXTENSION_FORMAT,
    ERR_ERC20_APPROVAL_FROM_MISMATCH,
    ERR_ERC20_APPROVAL_SPENDER_NOT_PERMIT2,
    ERR_ERC20_APPROVAL_TX_FAILED,
    ERR_ERC20_APPROVAL_TX_INVALID_CALLDATA,
    ERR_ERC20_APPROVAL_TX_INVALID_SIGNATURE,
    ERR_ERC20_APPROVAL_TX_PARSE_FAILED,
    ERR_ERC20_APPROVAL_TX_SIGNER_MISMATCH,
    ERR_ERC20_APPROVAL_TX_WRONG_SELECTOR,
    ERR_ERC20_APPROVAL_TX_WRONG_SPENDER,
    ERR_ERC20_APPROVAL_TX_WRONG_TARGET,
    ERR_NETWORK_MISMATCH,
    ERR_PERMIT2_2612_AMOUNT_MISMATCH,
    ERR_PERMIT2_ALLOWANCE_REQUIRED,
    ERR_PERMIT2_AMOUNT_MISMATCH,
    ERR_PERMIT2_DEADLINE_EXPIRED,
    ERR_PERMIT2_INVALID_AMOUNT,
    ERR_PERMIT2_INVALID_DESTINATION,
    ERR_PERMIT2_INVALID_FACILITATOR,
    ERR_PERMIT2_INVALID_NONCE,
    ERR_PERMIT2_INVALID_OWNER,
    ERR_PERMIT2_INVALID_SIGNATURE,
    ERR_PERMIT2_INVALID_SPENDER,
    ERR_PERMIT2_NOT_YET_VALID,
    ERR_PERMIT2_PAYMENT_TOO_EARLY,
    ERR_PERMIT2_RECIPIENT_MISMATCH,
    ERR_PERMIT2_TOKEN_MISMATCH,
    ERR_TRANSACTION_FAILED,
    ERR_UNSUPPORTED_SCHEME,
    PERMIT2_WITNESS_TYPES,
    get_permit2_address,
    get_x402_exact_permit2_proxy_address,
    x402ExactPermit2ProxyABI,
)
from ..signer import ClientEvmSigner, FacilitatorEvmSigner
from ..types import (
    ExactPermit2Payload,
    Permit2Authorization,
    Permit2Witness,
    TypedDataDomain,
    TypedDataField,
)
from ..utils import create_permit2_nonce, get_evm_chain_id, hex_to_bytes, normalize_address


def create_permit2_payload(
    signer: ClientEvmSigner,
    requirements: PaymentRequirements,
) -> dict[str, Any]:
    """Create signed Permit2 payload (inner payload only)."""
    now = int(time.time())
    nonce = create_permit2_nonce()

    valid_after = str(now - 600)
    deadline = str(now + (requirements.max_timeout_seconds or 3600))

    facilitator = (requirements.extra or {}).get("permit2FacilitatorAddress")
    if not facilitator:
        raise ValueError("Permit2 facilitator address required in payment requirements extra")

    authorization = Permit2Authorization(
        from_address=normalize_address(signer.address),
        permitted_token=normalize_address(requirements.asset),
        permitted_amount=requirements.amount,
        spender=normalize_address(get_x402_exact_permit2_proxy_address(str(requirements.network))),
        nonce=nonce,
        deadline=deadline,
        witness=Permit2Witness(
            to=normalize_address(requirements.pay_to),
            facilitator=normalize_address(str(facilitator)),
            valid_after=valid_after,
        ),
    )

    signature = _sign_permit2_authorization(signer, authorization, requirements)
    payload = ExactPermit2Payload(permit2_authorization=authorization, signature=signature)
    return payload.to_dict()


def verify_permit2(
    signer: FacilitatorEvmSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: ExactPermit2Payload,
    context: FacilitatorContext | None = None,
) -> VerifyResponse:
    """Verify a Permit2 payment payload on EVM."""
    payer = permit2_payload.permit2_authorization.from_address

    if payload.accepted.scheme != "exact" or requirements.scheme != "exact":
        return VerifyResponse(is_valid=False, invalid_reason=ERR_UNSUPPORTED_SCHEME, payer=payer)

    if payload.accepted.network != requirements.network:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

    network = str(requirements.network)
    token_address = normalize_address(requirements.asset)
    permit2_address = normalize_address(get_permit2_address(network))
    proxy_address = normalize_address(get_x402_exact_permit2_proxy_address(network))

    if normalize_address(permit2_payload.permit2_authorization.spender) != proxy_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SPENDER, payer=payer
        )

    if normalize_address(permit2_payload.permit2_authorization.witness.to) != normalize_address(
        requirements.pay_to
    ):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_RECIPIENT_MISMATCH, payer=payer
        )

    expected_facilitator = (requirements.extra or {}).get("permit2FacilitatorAddress")
    if not expected_facilitator:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_FACILITATOR, payer=payer
        )
    if normalize_address(
        permit2_payload.permit2_authorization.witness.facilitator
    ) != normalize_address(str(expected_facilitator)):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_FACILITATOR, payer=payer
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

    if normalize_address(permit2_payload.permit2_authorization.permitted_token) != token_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_TOKEN_MISMATCH, payer=payer
        )

    typed_fields: dict[str, list[TypedDataField]] = {}
    for type_name, fields in PERMIT2_WITNESS_TYPES.items():
        typed_fields[type_name] = [TypedDataField(name=f["name"], type=f["type"]) for f in fields]

    chain_id = get_evm_chain_id(network)
    domain = TypedDataDomain(
        name="Permit2", version=None, chain_id=chain_id, verifying_contract=permit2_address
    )
    message = {
        "permitted": {
            "token": normalize_address(permit2_payload.permit2_authorization.permitted_token),
            "amount": int(permit2_payload.permit2_authorization.permitted_amount),
        },
        "spender": normalize_address(permit2_payload.permit2_authorization.spender),
        "nonce": int(permit2_payload.permit2_authorization.nonce),
        "deadline": int(permit2_payload.permit2_authorization.deadline),
        "witness": {
            "to": normalize_address(permit2_payload.permit2_authorization.witness.to),
            "facilitator": normalize_address(
                permit2_payload.permit2_authorization.witness.facilitator
            ),
            "validAfter": int(permit2_payload.permit2_authorization.witness.valid_after),
        },
    }

    try:
        is_valid = signer.verify_typed_data(
            address=payer,
            domain=domain,
            types=typed_fields,
            primary_type="PermitWitnessTransferFrom",
            message=message,
            signature=hex_to_bytes(permit2_payload.signature),
        )
        if not is_valid:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
            )
    except Exception:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
        )

    # Check allowance (best-effort)
    try:
        allowance = signer.read_contract(
            token_address, ERC20_ALLOWANCE_ABI, "allowance", payer, permit2_address
        )
        if int(allowance) < int(requirements.amount):
            has_extension, extension_error = _verify_gas_sponsoring_extensions(
                payload, requirements, payer, permit2_address, context
            )
            if extension_error is not None:
                return extension_error
            if not has_extension:
                return VerifyResponse(
                    is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
                )
    except Exception:
        has_extension, extension_error = _verify_gas_sponsoring_extensions(
            payload, requirements, payer, permit2_address, context
        )
        if extension_error is not None:
            return extension_error
        if not has_extension:
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
            )

    # Check balance (best-effort)
    try:
        balance = signer.read_contract(token_address, BALANCE_OF_ABI, "balanceOf", payer)
        if int(balance) < int(requirements.amount):
            return VerifyResponse(
                is_valid=False,
                invalid_reason="insufficient_funds",
                invalid_message=(
                    f"Insufficient funds. Required: {requirements.amount}, Available: {balance}"
                ),
                payer=payer,
            )
    except Exception:
        pass

    return VerifyResponse(is_valid=True, payer=payer)


def settle_permit2(
    signer: FacilitatorEvmSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: ExactPermit2Payload,
    context: FacilitatorContext | None = None,
) -> SettleResponse:
    """Settle a Permit2 payment on-chain."""
    payer = permit2_payload.permit2_authorization.from_address
    verify_result = verify_permit2(signer, payload, requirements, permit2_payload, context)
    if not verify_result.is_valid:
        return SettleResponse(
            success=False,
            error_reason=verify_result.invalid_reason or ERR_UNSUPPORTED_SCHEME,
            transaction="",
            network=str(requirements.network),
            payer=payer,
        )

    proxy_address = get_x402_exact_permit2_proxy_address(str(requirements.network))

    eip2612_info = extract_eip2612_gas_sponsoring_info(payload.extensions)
    if eip2612_info and validate_eip2612_gas_sponsoring_info(eip2612_info):
        return _settle_with_eip2612(signer, payload, permit2_payload, eip2612_info)

    erc20_info = extract_erc20_approval_gas_sponsoring_info(payload.extensions)
    if (
        erc20_info
        and validate_erc20_approval_gas_sponsoring_info(erc20_info)
        and context is not None
    ):
        extension = context.get_extension(ERC20_APPROVAL_GAS_SPONSORING.key)
        if isinstance(extension, Erc20ApprovalGasSponsoringExtension) and extension.signer:
            return _settle_with_erc20_approval(
                extension.signer, payload, permit2_payload, erc20_info
            )
    try:
        tx = signer.write_contract(
            proxy_address,
            x402ExactPermit2ProxyABI,
            "settle",
            {
                "permitted": {
                    "token": normalize_address(
                        permit2_payload.permit2_authorization.permitted_token
                    ),
                    "amount": int(permit2_payload.permit2_authorization.permitted_amount),
                },
                "nonce": int(permit2_payload.permit2_authorization.nonce),
                "deadline": int(permit2_payload.permit2_authorization.deadline),
            },
            normalize_address(payer),
            {
                "to": normalize_address(permit2_payload.permit2_authorization.witness.to),
                "facilitator": normalize_address(
                    permit2_payload.permit2_authorization.witness.facilitator
                ),
                "validAfter": int(permit2_payload.permit2_authorization.witness.valid_after),
            },
            hex_to_bytes(permit2_payload.signature),
        )

        receipt = signer.wait_for_transaction_receipt(tx)
        if receipt.status != 1:
            return SettleResponse(
                success=False,
                error_reason="invalid_transaction_state",
                transaction=tx,
                network=str(requirements.network),
                payer=payer,
            )

        return SettleResponse(
            success=True,
            transaction=tx,
            network=str(requirements.network),
            payer=payer,
        )
    except Exception as e:
        error_reason = _map_settle_error(str(e))
        return SettleResponse(
            success=False,
            error_reason=error_reason,
            error_message=str(e),
            transaction="",
            network=str(requirements.network),
            payer=payer,
        )


def _sign_permit2_authorization(
    signer: ClientEvmSigner,
    authorization: Permit2Authorization,
    requirements: PaymentRequirements,
) -> str:
    chain_id = get_evm_chain_id(str(requirements.network))
    permit2_address = normalize_address(get_permit2_address(str(requirements.network)))

    domain = TypedDataDomain(
        name="Permit2", version=None, chain_id=chain_id, verifying_contract=permit2_address
    )
    types = PERMIT2_WITNESS_TYPES
    message = {
        "permitted": {
            "token": normalize_address(authorization.permitted_token),
            "amount": int(authorization.permitted_amount),
        },
        "spender": normalize_address(authorization.spender),
        "nonce": int(authorization.nonce),
        "deadline": int(authorization.deadline),
        "witness": {
            "to": normalize_address(authorization.witness.to),
            "facilitator": normalize_address(authorization.witness.facilitator),
            "validAfter": int(authorization.witness.valid_after),
        },
    }

    typed_fields: dict[str, list[TypedDataField]] = {}
    for type_name, fields in types.items():
        typed_fields[type_name] = [TypedDataField(name=f["name"], type=f["type"]) for f in fields]

    sig_bytes = signer.sign_typed_data(
        domain=domain,
        types=typed_fields,
        primary_type="PermitWitnessTransferFrom",
        message=message,
    )
    return "0x" + sig_bytes.hex()


def _verify_gas_sponsoring_extensions(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    payer: str,
    permit2_address: str,
    context: FacilitatorContext | None,
) -> tuple[bool, VerifyResponse | None]:
    eip2612_info = extract_eip2612_gas_sponsoring_info(payload.extensions)
    if eip2612_info:
        if not validate_eip2612_gas_sponsoring_info(eip2612_info):
            return True, VerifyResponse(
                is_valid=False, invalid_reason=ERR_EIP2612_EXTENSION_FORMAT, payer=payer
            )
        if normalize_address(eip2612_info.from_address) != normalize_address(payer):
            return True, VerifyResponse(
                is_valid=False, invalid_reason=ERR_EIP2612_FROM_MISMATCH, payer=payer
            )
        if normalize_address(eip2612_info.asset) != normalize_address(requirements.asset):
            return True, VerifyResponse(
                is_valid=False, invalid_reason=ERR_EIP2612_ASSET_MISMATCH, payer=payer
            )
        if normalize_address(eip2612_info.spender) != normalize_address(permit2_address):
            return True, VerifyResponse(
                is_valid=False,
                invalid_reason=ERR_EIP2612_SPENDER_NOT_PERMIT2,
                payer=payer,
            )
        now = int(time.time())
        if int(eip2612_info.deadline) < now + 6:
            return True, VerifyResponse(
                is_valid=False, invalid_reason=ERR_EIP2612_DEADLINE_EXPIRED, payer=payer
            )
        return True, None

    erc20_info = extract_erc20_approval_gas_sponsoring_info(payload.extensions)
    if not erc20_info:
        return False, None

    if context is None or context.get_extension(ERC20_APPROVAL_GAS_SPONSORING.key) is None:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
        )

    if not validate_erc20_approval_gas_sponsoring_info(erc20_info):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_EXTENSION_FORMAT, payer=payer
        )
    if normalize_address(erc20_info.from_address) != normalize_address(payer):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_FROM_MISMATCH, payer=payer
        )
    if normalize_address(erc20_info.asset) != normalize_address(requirements.asset):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_ASSET_MISMATCH, payer=payer
        )
    if normalize_address(erc20_info.spender) != normalize_address(permit2_address):
        return True, VerifyResponse(
            is_valid=False,
            invalid_reason=ERR_ERC20_APPROVAL_SPENDER_NOT_PERMIT2,
            payer=payer,
        )

    tx_info = _parse_erc20_approval_signed_transaction(erc20_info.signed_transaction)
    if tx_info is None:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_PARSE_FAILED, payer=payer
        )

    tx_to = tx_info.get("to")
    if not tx_to or normalize_address(tx_to) != normalize_address(requirements.asset):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_WRONG_TARGET, payer=payer
        )

    tx_data = str(tx_info.get("data", "")).lower()
    if not tx_data.startswith("0x095ea7b3"):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_WRONG_SELECTOR, payer=payer
        )

    decoded_spender = _decode_erc20_approval_spender(tx_data)
    if decoded_spender is None:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_INVALID_CALLDATA, payer=payer
        )
    if normalize_address(decoded_spender) != normalize_address(permit2_address):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_WRONG_SPENDER, payer=payer
        )

    recovered = _recover_erc20_approval_signer(erc20_info.signed_transaction)
    if recovered is None:
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_INVALID_SIGNATURE, payer=payer
        )
    if normalize_address(recovered) != normalize_address(payer):
        return True, VerifyResponse(
            is_valid=False, invalid_reason=ERR_ERC20_APPROVAL_TX_SIGNER_MISMATCH, payer=payer
        )
    return True, None


def _settle_with_eip2612(
    signer: FacilitatorEvmSigner,
    payload: PaymentPayload,
    permit2_payload: ExactPermit2Payload,
    info: Any,
) -> SettleResponse:
    payer = permit2_payload.permit2_authorization.from_address
    proxy_address = get_x402_exact_permit2_proxy_address(str(payload.accepted.network))
    try:
        v, r, s = _split_eip2612_signature(str(info.signature))
        tx = signer.write_contract(
            proxy_address,
            x402ExactPermit2ProxyABI,
            "settleWithPermit",
            {
                "value": int(info.amount),
                "deadline": int(info.deadline),
                "r": r,
                "s": s,
                "v": v,
            },
            {
                "permitted": {
                    "token": normalize_address(
                        permit2_payload.permit2_authorization.permitted_token
                    ),
                    "amount": int(permit2_payload.permit2_authorization.permitted_amount),
                },
                "nonce": int(permit2_payload.permit2_authorization.nonce),
                "deadline": int(permit2_payload.permit2_authorization.deadline),
            },
            normalize_address(payer),
            {
                "to": normalize_address(permit2_payload.permit2_authorization.witness.to),
                "facilitator": normalize_address(
                    permit2_payload.permit2_authorization.witness.facilitator
                ),
                "validAfter": int(permit2_payload.permit2_authorization.witness.valid_after),
            },
            hex_to_bytes(permit2_payload.signature),
        )
        receipt = signer.wait_for_transaction_receipt(tx)
        if receipt.status != 1:
            return SettleResponse(
                success=False,
                error_reason="invalid_transaction_state",
                transaction=tx,
                network=str(payload.accepted.network),
                payer=payer,
            )
        return SettleResponse(
            success=True,
            transaction=tx,
            network=str(payload.accepted.network),
            payer=payer,
        )
    except Exception as e:
        return SettleResponse(
            success=False,
            error_reason=_map_settle_error(str(e)),
            error_message=str(e),
            transaction="",
            network=str(payload.accepted.network),
            payer=payer,
        )


def _settle_with_erc20_approval(
    signer: Any,
    payload: PaymentPayload,
    permit2_payload: ExactPermit2Payload,
    info: Any,
) -> SettleResponse:
    payer = permit2_payload.permit2_authorization.from_address
    proxy_address = get_x402_exact_permit2_proxy_address(str(payload.accepted.network))
    try:
        tx_hash = signer.send_raw_transaction(info.signed_transaction)
        receipt = signer.wait_for_transaction_receipt(tx_hash)
        if receipt.status != 1:
            return SettleResponse(
                success=False,
                error_reason=ERR_ERC20_APPROVAL_TX_FAILED,
                transaction=tx_hash,
                network=str(payload.accepted.network),
                payer=payer,
            )

        tx = signer.write_contract(
            proxy_address,
            x402ExactPermit2ProxyABI,
            "settle",
            {
                "permitted": {
                    "token": normalize_address(
                        permit2_payload.permit2_authorization.permitted_token
                    ),
                    "amount": int(permit2_payload.permit2_authorization.permitted_amount),
                },
                "nonce": int(permit2_payload.permit2_authorization.nonce),
                "deadline": int(permit2_payload.permit2_authorization.deadline),
            },
            normalize_address(payer),
            {
                "to": normalize_address(permit2_payload.permit2_authorization.witness.to),
                "facilitator": normalize_address(
                    permit2_payload.permit2_authorization.witness.facilitator
                ),
                "validAfter": int(permit2_payload.permit2_authorization.witness.valid_after),
            },
            hex_to_bytes(permit2_payload.signature),
        )
        settle_receipt = signer.wait_for_transaction_receipt(tx)
        if settle_receipt.status != 1:
            return SettleResponse(
                success=False,
                error_reason="invalid_transaction_state",
                transaction=tx,
                network=str(payload.accepted.network),
                payer=payer,
            )
        return SettleResponse(
            success=True,
            transaction=tx,
            network=str(payload.accepted.network),
            payer=payer,
        )
    except Exception as e:
        return SettleResponse(
            success=False,
            error_reason=_map_settle_error(str(e)),
            error_message=str(e),
            transaction="",
            network=str(payload.accepted.network),
            payer=payer,
        )


def _split_eip2612_signature(signature: str) -> tuple[int, str, str]:
    sig = signature.removeprefix("0x")
    if len(sig) != 130:
        raise ValueError("invalid EIP-2612 signature length")
    r = "0x" + sig[:64]
    s = "0x" + sig[64:128]
    v = int(sig[128:130], 16)
    return v, r, s


def _map_settle_error(message: str) -> str:
    if "Permit2612AmountMismatch" in message:
        return ERR_PERMIT2_2612_AMOUNT_MISMATCH
    if "InvalidAmount" in message:
        return ERR_PERMIT2_INVALID_AMOUNT
    if "InvalidDestination" in message:
        return ERR_PERMIT2_INVALID_DESTINATION
    if "InvalidOwner" in message:
        return ERR_PERMIT2_INVALID_OWNER
    if "PaymentTooEarly" in message:
        return ERR_PERMIT2_PAYMENT_TOO_EARLY
    if "InvalidNonce" in message:
        return ERR_PERMIT2_INVALID_NONCE
    if "InvalidSignature" in message or "SignatureExpired" in message:
        return ERR_PERMIT2_INVALID_SIGNATURE
    return ERR_TRANSACTION_FAILED


def _parse_erc20_approval_signed_transaction(signed_tx: str) -> dict[str, str] | None:
    try:
        parsed = TypedTransaction.from_bytes(HexBytes(signed_tx))
        tx = parsed.as_dict()
        to_val = tx.get("to")
        data_val = tx.get("data")

        to_hex: str | None = None
        if isinstance(to_val, (bytes, bytearray)):
            to_hex = "0x" + bytes(to_val).hex()
        elif isinstance(to_val, str):
            to_hex = to_val

        data_hex: str | None = None
        if isinstance(data_val, (bytes, bytearray)):
            data_hex = "0x" + bytes(data_val).hex()
        elif isinstance(data_val, str):
            data_hex = data_val

        if not to_hex or data_hex is None:
            return None
        return {"to": to_hex, "data": data_hex}
    except Exception:
        return None


def _decode_erc20_approval_spender(data_hex: str) -> str | None:
    cleaned = data_hex.removeprefix("0x")
    if not cleaned.startswith("095ea7b3") or len(cleaned) < 8 + 64 + 64:
        return None
    spender_word = cleaned[8 : 8 + 64]
    return "0x" + spender_word[24:].lower()


def _recover_erc20_approval_signer(signed_tx: str) -> str | None:
    try:
        return str(Account.recover_transaction(HexBytes(signed_tx)))
    except Exception:
        return None
