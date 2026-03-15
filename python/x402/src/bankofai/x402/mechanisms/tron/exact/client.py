"""TRON client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import time
from typing import Any

from ....schemas import PaymentRequirements
from ..constants import (
    AUTHORIZATION_TYPES,
    ERR_INSUFFICIENT_FUNDS,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    SCHEME_EXACT,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signers import ClientTronSigner
from ..utils import create_nonce, get_tron_chain_id, normalize_address_for_signing


class ExactTronClientScheme:
    """TRON client implementation for the Exact payment scheme (V2).

    Attributes:
        scheme: The scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self, signer: ClientTronSigner):
        """Create ExactTronClientScheme.

        Args:
            signer: TRON signer for payment authorizations.
        """
        self._signer = signer

    def create_payment_payload(
        self,
        requirements: PaymentRequirements,
    ) -> dict[str, Any]:
        """Create signed TIP-712 inner payload (Permit2 or EIP3009).

        Args:
            requirements: Payment requirements from server.

        Returns:
            Inner payload dict (authorization + signature).
        """
        self._ensure_sufficient_balance(requirements)

        extra = requirements.extra or {}
        method = extra.get("assetTransferMethod", "eip3009")

        if method == "permit2":
            return self._create_permit2_payload(requirements)
        else:
            return self._create_eip3009_payload(requirements)

    def _create_eip3009_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        """Create TIP-712 TransferWithAuthorization payload."""
        nonce = create_nonce()
        now = int(time.time())
        valid_after = 0
        valid_before = now + (requirements.max_timeout_seconds or 3600)

        authorization = {
            "from": self._signer.address,
            "to": requirements.pay_to,
            "value": str(requirements.amount),
            "validAfter": str(valid_after),
            "validBefore": str(valid_before),
            "nonce": nonce,
        }

        signature = self._sign_eip3009(authorization, requirements)

        return {
            "authorization": authorization,
            "signature": signature,
        }

    def _sign_eip3009(
        self, authorization: dict[str, Any], requirements: PaymentRequirements
    ) -> str:
        """Sign TIP-712 domain and message."""
        extra = requirements.extra or {}
        chain_id = get_tron_chain_id(str(requirements.network))

        domain = {
            "name": extra.get("name", "Tether USD"),
            "version": extra.get("version", "1"),
            "chainId": chain_id,
            "verifyingContract": normalize_address_for_signing(requirements.asset),
        }

        message = {
            "from": normalize_address_for_signing(authorization["from"]),
            "to": normalize_address_for_signing(authorization["to"]),
            "value": int(authorization["value"]),
            "validAfter": int(authorization["validAfter"]),
            "validBefore": int(authorization["validBefore"]),
            "nonce": bytes.fromhex(authorization["nonce"].removeprefix("0x")),
        }

        return self._signer.sign_typed_data(
            domain=domain,
            types=AUTHORIZATION_TYPES,
            primary_type="TransferWithAuthorization",
            message=message,
        )

    def _create_permit2_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        """Create TIP-712 Permit2 payload."""
        now = int(time.time())
        nonce = create_nonce()
        network = str(requirements.network)

        permit2_address = PERMIT2_ADDRESSES.get(network)
        if not permit2_address:
            raise ValueError(f"No Permit2 contract address configured for network {network}")

        proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
        if not proxy_address:
            raise ValueError(
                f"No x402Permit2Proxy contract address configured for network {network}"
            )

        facilitator_address = (requirements.extra or {}).get("permit2FacilitatorAddress") or (
            requirements.extra or {}
        ).get("facilitatorAddress")
        if not facilitator_address:
            raise ValueError(
                "Permit2 facilitator address is required in payment requirements extra"
            )

        self._ensure_permit2_allowance(requirements, permit2_address)

        permit2_authorization = {
            "from": normalize_address_for_signing(self._signer.address),
            "permitted": {
                "token": normalize_address_for_signing(requirements.asset),
                "amount": str(requirements.amount),
            },
            "spender": normalize_address_for_signing(proxy_address),
            "nonce": nonce,
            "deadline": str(now + (requirements.max_timeout_seconds or 3600)),
            "witness": {
                "to": normalize_address_for_signing(requirements.pay_to),
                "facilitator": normalize_address_for_signing(str(facilitator_address)),
                "validAfter": str(now - 600),
            },
        }

        signature = self._sign_permit2(permit2_authorization, requirements)

        return {
            "permit2Authorization": permit2_authorization,
            "signature": signature,
        }

    def _sign_permit2(
        self, permit2_authorization: dict[str, Any], requirements: PaymentRequirements
    ) -> str:
        """Sign a PermitWitnessTransferFrom payload."""
        network = str(requirements.network)
        permit2_address = PERMIT2_ADDRESSES.get(network)
        if not permit2_address:
            raise ValueError(f"No Permit2 contract address configured for network {network}")

        domain = {
            "name": "Permit2",
            "chainId": get_tron_chain_id(network),
            "verifyingContract": normalize_address_for_signing(permit2_address),
        }

        message = {
            "permitted": {
                "token": permit2_authorization["permitted"]["token"],
                "amount": int(permit2_authorization["permitted"]["amount"]),
            },
            "spender": permit2_authorization["spender"],
            "nonce": int(str(permit2_authorization["nonce"]), 0),
            "deadline": int(permit2_authorization["deadline"]),
            "witness": {
                "to": permit2_authorization["witness"]["to"],
                "facilitator": permit2_authorization["witness"]["facilitator"],
                "validAfter": int(permit2_authorization["witness"]["validAfter"]),
            },
        }

        return self._signer.sign_typed_data(
            domain=domain,
            types=PERMIT2_WITNESS_TYPES,
            primary_type="PermitWitnessTransferFrom",
            message=message,
        )

    def _ensure_sufficient_balance(self, requirements: PaymentRequirements) -> None:
        """Check TRC-20 balance before signing a payment payload."""
        balance = self._signer.read_contract(
            address=requirements.asset,
            function_name="balanceOf",
            args=[self._signer.address],
        )
        if int(str(balance)) < int(requirements.amount):
            raise ValueError(
                f"{ERR_INSUFFICIENT_FUNDS}: Insufficient token balance. Required: {requirements.amount}, Available: {balance}"
            )

    def _ensure_permit2_allowance(
        self, requirements: PaymentRequirements, permit2_address: str
    ) -> None:
        """Best-effort local Permit2 approval fallback when sponsoring is unavailable."""
        allowance = int(
            str(
                self._signer.read_contract(
                    address=requirements.asset,
                    function_name="allowance",
                    args=[self._signer.address, permit2_address],
                )
            )
        )
        if allowance >= int(requirements.amount):
            return

        write_contract = getattr(self._signer, "write_contract", None)
        wait_for_receipt = getattr(self._signer, "wait_for_transaction_receipt", None)
        if not callable(write_contract) or not callable(wait_for_receipt):
            return

        tx_hash = write_contract(
            requirements.asset,
            "approve",
            [permit2_address, (1 << 256) - 1],
        )
        receipt = wait_for_receipt(tx_hash)
        status = getattr(receipt, "status", None)
        if status not in ("success", 1):
            raise ValueError(
                f"transaction_failed: local Permit2 approval failed with status={status}"
            )
