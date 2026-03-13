"""TRON facilitator scheme for the Exact payment mechanism (v2 Python SDK).

Implements verify() and settle() for TIP-712 TransferWithAuthorization payments
on TRON (nile, shasta, mainnet).
"""

import time

from ....schemas import (
    Network,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
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


class ExactTronScheme:
    """TRON facilitator for the Exact payment scheme (TIP-712 TransferWithAuthorization).

    Attributes:
        scheme: Always "exact".
        caip_family: Always "tron:*".
    """

    scheme = SCHEME_EXACT
    caip_family = "tron:*"

    def __init__(self, signer: FacilitatorTronSigner) -> None:
        """Create scheme with given TRON facilitator signer.

        Args:
            signer: FacilitatorTronSigner for verification and settlement.
        """
        self._signer = signer

    def get_extra(self, network: Network) -> dict | None:
        """Return extra facilitator metadata (supported methods)."""
        return {"supportedAssetTransferMethods": ["eip3009"]}

    def get_signers(self, network: Network) -> list[str]:
        """Return facilitator addresses."""
        return self._signer.get_addresses()

    def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context=None,
    ) -> VerifyResponse:
        """Verify a TIP-712 payment payload.

        Args:
            payload: Payment payload from the client.
            requirements: Payment requirements from the server.

        Returns:
            VerifyResponse with is_valid flag and optional failure reason.
        """
        raw = payload.payload or {}
        auth = raw.get("authorization", {})
        payer = auth.get("from", "")

        # --- Scheme check ---
        if payload.accepted.scheme != SCHEME_EXACT or requirements.scheme != SCHEME_EXACT:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SCHEME, payer=payer)

        # --- TIP-712 domain params ---
        extra = requirements.extra or {}
        if "name" not in extra or "version" not in extra:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_MISSING_TIP712_DOMAIN, payer=payer)

        # --- Network match ---
        if str(payload.accepted.network) != str(requirements.network):
            return VerifyResponse(is_valid=False, invalid_reason=ERR_NETWORK_MISMATCH, payer=payer)

        # --- Build TIP-712 typed data and verify ---
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
        message = {
            "from": normalize_address_for_signing(auth.get("from", "")),
            "to": normalize_address_for_signing(auth.get("to", "")),
            "value": int(auth.get("value", 0)),
            "validAfter": int(auth.get("validAfter", 0)),
            "validBefore": int(auth.get("validBefore", 0)),
            "nonce": auth.get("nonce", "0x" + "00" * 32),
        }

        signature = raw.get("signature", "")
        is_valid = self._signer.verify_typed_data(
            address=auth.get("from", ""),
            domain=domain,
            types=AUTHORIZATION_TYPES,
            primary_type="TransferWithAuthorization",
            message=message,
            signature=signature,
        )
        if not is_valid:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_INVALID_SIGNATURE, payer=payer)

        # --- Recipient check ---
        payload_to = normalize_address_for_signing(auth.get("to", ""))
        required_to = normalize_address_for_signing(requirements.pay_to)
        if payload_to != required_to:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_RECIPIENT_MISMATCH, payer=payer)

        # --- Timing check ---
        now = int(time.time())
        valid_before = int(auth.get("validBefore", 0))
        valid_after = int(auth.get("validAfter", 0))
        if valid_before < now + 6:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_VALID_BEFORE_EXPIRED, payer=payer)
        if valid_after > now:
            return VerifyResponse(is_valid=False, invalid_reason=ERR_VALID_AFTER_FUTURE, payer=payer)

        # --- Amount check ---
        if int(auth.get("value", 0)) != int(requirements.amount):
            return VerifyResponse(is_valid=False, invalid_reason=ERR_VALUE_MISMATCH, payer=payer)

        # --- Balance check (best-effort) ---
        try:
            balance = self._signer.read_contract(
                address=requirements.asset,
                function_name="balanceOf",
                *[auth.get("from", "")],
            )
            if int(balance) < int(requirements.amount):
                return VerifyResponse(
                    is_valid=False,
                    invalid_reason=ERR_INSUFFICIENT_FUNDS,
                    invalid_message=(
                        f"Insufficient funds. Required: {requirements.amount}, "
                        f"Available: {balance}"
                    ),
                    payer=payer,
                )
        except Exception:
            pass  # Continue if balance check fails

        return VerifyResponse(is_valid=True, payer=payer)

    def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        context=None,
    ) -> SettleResponse:
        """Settle a TIP-712 payment on-chain.

        Re-verifies, then calls transferWithAuthorization.

        Args:
            payload: Verified payment payload.
            requirements: Payment requirements.

        Returns:
            SettleResponse with success, transaction hash, network, payer.
        """
        raw = payload.payload or {}
        auth = raw.get("authorization", {})
        payer = auth.get("from", "")
        network = str(requirements.network)

        # Re-verify
        verify_result = self.verify(payload, requirements, context)
        if not verify_result.is_valid:
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason or ERR_INVALID_SCHEME,
                transaction="",
                network=network,
                payer=payer,
            )

        # Parse signature into v, r, s
        signature = raw.get("signature", "")
        clean_sig = signature.lstrip("0x")
        r = "0x" + clean_sig[:64]
        s = "0x" + clean_sig[64:128]
        v = int(clean_sig[128:130], 16)

        try:
            tx = self._signer.write_contract(
                address=requirements.asset,
                function_name="transferWithAuthorization",
                fee_limit=1_000_000_000,
                *[
                    auth.get("from", ""),
                    auth.get("to", ""),
                    int(auth.get("value", 0)),
                    int(auth.get("validAfter", 0)),
                    int(auth.get("validBefore", 0)),
                    auth.get("nonce", "0x" + "00" * 32),
                    v,
                    r,
                    s,
                ],
            )

            receipt = self._signer.wait_for_transaction_receipt(tx)
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
