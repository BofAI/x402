"""TRON client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import time
from typing import Any

from ....extensions.trc20_approval_gas_sponsoring import TRC20_APPROVAL_GAS_SPONSORING
from ....interfaces import PaymentPayloadContext
from ....schemas import PaymentRequirements
from ..constants import (
    AUTHORIZATION_TYPES,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    SCHEME_EXACT,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..signer import ClientTronSigner
from ..types import (
    ExactEIP3009Authorization,
    ExactEIP3009Payload,
    ExactPermit2Payload,
    Permit2Authorization,
    Permit2Witness,
)
from ..utils import create_nonce, get_tron_chain_id, normalize_address_for_signing
from .trc20approval import sign_trc20_approval_transaction


class ExactTronClientScheme:
    """TRON client implementation for the Exact payment scheme (V2)."""

    scheme = SCHEME_EXACT

    def __init__(self, signer: ClientTronSigner):
        self._signer = signer

    def create_payment_payload(
        self, requirements: PaymentRequirements, context: PaymentPayloadContext | None = None
    ) -> dict[str, Any] | tuple[dict[str, Any], dict[str, Any]]:
        extra = requirements.extra or {}
        asset_transfer_method = extra.get("assetTransferMethod", "eip3009")

        if asset_transfer_method == "permit2":
            payload = self._create_permit2_payload(requirements)
            extensions = self._try_build_trc20_approval_extension(requirements, context)
            if extensions:
                return payload, extensions
            return payload

        return self._create_eip3009_payload(requirements)

    def _create_eip3009_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        nonce = create_nonce()
        now = int(time.time())

        authorization = ExactEIP3009Authorization(
            from_address=normalize_address_for_signing(self._signer.address),
            to=normalize_address_for_signing(requirements.pay_to),
            value=str(requirements.amount),
            valid_after=str(now - 600),
            valid_before=str(now + (requirements.max_timeout_seconds or 3600)),
            nonce=nonce,
        )

        signature = self._sign_eip3009(authorization, requirements)
        payload = ExactEIP3009Payload(authorization=authorization, signature=signature)
        return payload.to_dict()

    def _try_build_trc20_approval_extension(
        self, requirements: PaymentRequirements, context: PaymentPayloadContext | None
    ) -> dict[str, Any] | None:
        if context is None or not context.extensions:
            return None
        if TRC20_APPROVAL_GAS_SPONSORING.key not in context.extensions:
            return None
        if not hasattr(self._signer, "build_trigger_smart_contract_transaction") or not hasattr(
            self._signer, "sign_transaction"
        ):
            return None

        permit2_address = PERMIT2_ADDRESSES.get(str(requirements.network))
        if not permit2_address:
            return None

        try:
            allowance = self._signer.read_contract(
                address=requirements.asset,
                function_name="allowance",
                args=[self._signer.address, permit2_address],
            )
            if int(str(allowance)) >= int(str(requirements.amount)):
                return None
        except Exception:
            # If allowance cannot be read, still try to provide the approval transaction.
            pass

        info = sign_trc20_approval_transaction(
            self._signer,
            requirements.asset,
            str(requirements.network),
        )
        return {TRC20_APPROVAL_GAS_SPONSORING.key: {"info": info, "schema": {}}}

    def _sign_eip3009(
        self, authorization: ExactEIP3009Authorization, requirements: PaymentRequirements
    ) -> str:
        extra = requirements.extra or {}
        if "name" not in extra or "version" not in extra:
            raise ValueError(
                f"TIP-712 domain parameters (name, version) required for {requirements.asset}"
            )

        domain = {
            "name": extra["name"],
            "version": extra["version"],
            "chainId": get_tron_chain_id(str(requirements.network)),
            "verifyingContract": normalize_address_for_signing(requirements.asset),
        }

        message = {
            "from": normalize_address_for_signing(authorization.from_address),
            "to": normalize_address_for_signing(authorization.to),
            "value": int(authorization.value),
            "validAfter": int(authorization.valid_after),
            "validBefore": int(authorization.valid_before),
            "nonce": bytes.fromhex(authorization.nonce.removeprefix("0x")),
        }

        return self._signer.sign_typed_data(
            domain=domain,
            types=AUTHORIZATION_TYPES,
            primary_type="TransferWithAuthorization",
            message=message,
        )

    def _create_permit2_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        now = int(time.time())
        network = str(requirements.network)

        permit2_address = PERMIT2_ADDRESSES.get(network)
        if not permit2_address:
            raise ValueError(f"No Permit2 contract address configured for network {network}")

        proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
        if not proxy_address:
            raise ValueError(f"No x402Permit2Proxy contract address configured for network {network}")

        facilitator_address = (requirements.extra or {}).get("permit2FacilitatorAddress") or (
            requirements.extra or {}
        ).get("facilitatorAddress")
        if not facilitator_address:
            raise ValueError("Permit2 facilitator address required in payment requirements extra")

        permit2_authorization = Permit2Authorization(
            from_address=normalize_address_for_signing(self._signer.address),
            permitted_token=normalize_address_for_signing(requirements.asset),
            permitted_amount=str(requirements.amount),
            spender=normalize_address_for_signing(proxy_address),
            nonce=create_nonce(),
            deadline=str(now + (requirements.max_timeout_seconds or 3600)),
            witness=Permit2Witness(
                to=normalize_address_for_signing(requirements.pay_to),
                facilitator=normalize_address_for_signing(str(facilitator_address)),
                valid_after=str(now - 600),
            ),
        )

        signature = self._sign_permit2(permit2_authorization, requirements)
        payload = ExactPermit2Payload(permit2_authorization=permit2_authorization, signature=signature)
        return payload.to_dict()

    def _sign_permit2(
        self, authorization: Permit2Authorization, requirements: PaymentRequirements
    ) -> str:
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
                "token": authorization.permitted_token,
                "amount": int(authorization.permitted_amount),
            },
            "spender": authorization.spender,
            "nonce": int(authorization.nonce, 0),
            "deadline": int(authorization.deadline),
            "witness": {
                "to": authorization.witness.to,
                "facilitator": authorization.witness.facilitator,
                "validAfter": int(authorization.witness.valid_after),
            },
        }

        return self._signer.sign_typed_data(
            domain=domain,
            types=PERMIT2_WITNESS_TYPES,
            primary_type="PermitWitnessTransferFrom",
            message=message,
        )
