"""TRON client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import time
from typing import Any

from ....schemas import PaymentRequirements
from ..constants import AUTHORIZATION_TYPES, SCHEME_EXACT
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

    def _sign_eip3009(self, authorization: dict[str, Any], requirements: PaymentRequirements) -> str:
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
        # For now, we reuse EIP-3009 logic as it's the primary demo method.
        # True Permit2 support can be added if required by specific TRON contracts.
        return self._create_eip3009_payload(requirements)
