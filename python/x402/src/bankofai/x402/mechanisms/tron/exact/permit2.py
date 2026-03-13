"""TRON Permit2 facilitator logic: verify and settle Permit2 payments.

Mirrors the TypeScript verifyPermit2() / settlePermit2() functions exactly.
"""

import time
from typing import Any

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
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signers import FacilitatorTronSigner
from ..utils import get_tron_chain_id, normalize_address_for_signing


def verify_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: dict[str, Any],
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
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_MISSING_PERMIT2_ADDRESS, payer=payer
        )

    normalized_proxy = normalize_address_for_signing(proxy_address)
    token_address = normalize_address_for_signing(requirements.asset)

    # Spender must be x402Permit2Proxy
    spender = normalize_address_for_signing(auth.get("spender", ""))
    if spender != normalized_proxy:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_SPENDER, payer=payer
        )

    # Recipient check
    witness = auth.get("witness", {})
    payload_to = normalize_address_for_signing(witness.get("to", ""))
    required_to = normalize_address_for_signing(requirements.pay_to)
    if payload_to != required_to:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_RECIPIENT_MISMATCH, payer=payer
        )

    # Facilitator check
    payload_facilitator = normalize_address_for_signing(witness.get("facilitator", ""))
    if payload_facilitator not in facilitator_addresses:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_INVALID_PERMIT2_FACILITATOR, payer=payer
        )

    # Timing checks
    now = int(time.time())
    if int(auth.get("deadline", 0)) < now + 6:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_DEADLINE_EXPIRED, payer=payer
        )
    if int(witness.get("validAfter", 0)) > now:
        return VerifyResponse(is_valid=False, invalid_reason=ERR_PERMIT2_NOT_YET_VALID, payer=payer)

    # Amount check
    permitted = auth.get("permitted", {})
    if int(permitted.get("amount", 0)) != int(requirements.amount):
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_AMOUNT_MISMATCH, payer=payer
        )

    # Token check
    if normalize_address_for_signing(permitted.get("token", "")) != token_address:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_TOKEN_MISMATCH, payer=payer
        )

    # Signature verification
    try:
        chain_id = get_tron_chain_id(network)
        normalized_permit2 = normalize_address_for_signing(permit2_address)
        domain = {"name": "Permit2", "chainId": chain_id, "verifyingContract": normalized_permit2}
        message = {
            "permitted": {
                "token": str(permitted.get("token", "")),
                "amount": int(str(permitted.get("amount", 0))),
            },
            "spender": str(auth.get("spender", "")),
            "nonce": int(str(auth.get("nonce", 0)), 0),
            "deadline": int(str(auth.get("deadline", 0))),
            "witness": {
                "to": str(witness.get("to", "")),
                "facilitator": str(witness.get("facilitator", "")),
                "validAfter": int(str(witness.get("validAfter", 0))),
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
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
            )
    except Exception:
        return VerifyResponse(
            is_valid=False, invalid_reason=ERR_PERMIT2_INVALID_SIGNATURE, payer=payer
        )

    # Allowance check (best-effort)
    try:
        allowance = signer.read_contract(
            address=requirements.asset,
            function_name="allowance",
            args=[payer, permit2_address],
        )
        if int(str(allowance)) < int(str(requirements.amount)):
            return VerifyResponse(
                is_valid=False, invalid_reason=ERR_PERMIT2_ALLOWANCE_REQUIRED, payer=payer
            )
    except Exception:
        pass

    # Balance check (best-effort)
    try:
        balance = signer.read_contract(
            address=requirements.asset,
            function_name="balanceOf",
            args=[payer],
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


def settle_permit2(
    signer: FacilitatorTronSigner,
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    permit2_payload: dict[str, Any],
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

    # Build tuple args as actual Python tuples so TronPy's encode_single doesn't complain
    permit_tuple = (
        (str(permitted.get("token", "")), int(str(permitted.get("amount", 0)))),
        int(str(auth.get("nonce", 0)), 0),
        int(str(auth.get("deadline", 0))),
    )
    witness_tuple = (
        str(witness.get("to", "")),
        str(witness.get("facilitator", "")),
        int(str(witness.get("validAfter", 0))),
    )
    signature_hex = str(permit2_payload.get("signature", ""))
    signature_bytes = bytes.fromhex(signature_hex.removeprefix("0x"))

    # We have to manually encode this because TronPy's `trx_abi` doesn't
    # currently recursively parse tuple structures perfectly without throwing "ABIEncoderV2 used."
    # We bypass TronPy's trx_abi completely because it lacks proper ABIEncoderV2 tuple support
    try:
        from eth_abi import encode
        from eth_utils import keccak
        # TRON addresses must be converted to 0x-prefixed hex for eth_abi
        def evm_addr(addr: str) -> str:
            return normalize_address_for_signing(addr)

        permit_evm = (
            (evm_addr(permitted.get("token", "")), int(str(permitted.get("amount", 0)))),
            int(str(auth.get("nonce", 0)), 0),
            int(str(auth.get("deadline", 0))),
        )
        witness_evm = (
            evm_addr(witness.get("to", "")),
            evm_addr(witness.get("facilitator", "")),
            int(str(witness.get("validAfter", 0))),
        )
        payer_evm = evm_addr(payer)

        signature = "settle(((address,uint256),uint256,uint256),address,(address,address,uint256),bytes)"
        selector = keccak(text=signature)[:4].hex()

        types = [
            "((address,uint256),uint256,uint256)",
            "address",
            "(address,address,uint256)",
            "bytes"
        ]
        encoded_args = encode(types, [permit_evm, payer_evm, witness_evm, signature_bytes]).hex()

        from tronpy.keys import to_hex_address

        txn = (
            signer._client.trx._build_transaction(
                "TriggerSmartContract",
                {
                    "owner_address": to_hex_address(signer._address),
                    "contract_address": to_hex_address(proxy_address),
                    "data": selector + encoded_args,
                    "call_value": 0,
                }
            )
        )
        # Apply fee limit
        txn = txn.fee_limit(1_000_000_000)
        # Build, sign and broadcast
        signed_txn = txn.build().sign(signer._pk)
        result = signed_txn.broadcast()
        tx = str(result.txid)

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
        import traceback
        traceback.print_exc()
        return SettleResponse(
            success=False,
            error_reason="transaction_failed",
            error_message=str(e),
            transaction="",
            network=network,
            payer=payer,
        )



def _get_permit2_proxy_abi() -> list[dict[str, Any]]:
    """Return the x402Permit2Proxy ABI for the settle function."""
    return [
        {
            "type": "function",
            "name": "settle",
            "inputs": [
                {
                    "name": "permit",
                    "type": "tuple",
                    "components": [
                        {
                            "name": "permitted",
                            "type": "tuple",
                            "components": [
                                {"name": "token", "type": "address"},
                                {"name": "amount", "type": "uint256"},
                            ],
                        },
                        {"name": "nonce", "type": "uint256"},
                        {"name": "deadline", "type": "uint256"},
                    ],
                },
                {"name": "owner", "type": "address"},
                {
                    "name": "witness",
                    "type": "tuple",
                    "components": [
                        {"name": "to", "type": "address"},
                        {"name": "facilitator", "type": "address"},
                        {"name": "validAfter", "type": "uint256"},
                    ],
                },
                {"name": "signature", "type": "bytes"},
            ],
            "outputs": [],
            "stateMutability": "nonpayable",
        }
    ]
