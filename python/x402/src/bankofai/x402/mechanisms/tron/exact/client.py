"""TRON client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import time
from typing import Any

from ....extensions.eip2612_gas_sponsoring import EIP2612_GAS_SPONSORING
from ....extensions.trc20_approval_gas_sponsoring import TRC20_APPROVAL_GAS_SPONSORING
from ....interfaces import PaymentPayloadContext
from ....schemas import PaymentRequirements
from ..constants import (
    AUTHORIZATION_TYPES,
    EIP2612_NONCES_ABI,
    EIP2612_PERMIT_TYPES,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    SCHEME_EXACT,
    TRC20_ALLOWANCE_ABI,
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
        asset_transfer_method = extra.get("assetTransferMethod", "transferWithAuthorization")
        if asset_transfer_method in {"tip712", "eip3009"}:
            asset_transfer_method = "transferWithAuthorization"

        if asset_transfer_method == "permit2":
            payload = self._create_permit2_payload(requirements)
            extensions = self._try_build_gas_sponsoring_extensions(
                requirements, payload, context
            )
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

    def _try_build_gas_sponsoring_extensions(
        self,
        requirements: PaymentRequirements,
        payload: dict[str, Any],
        context: PaymentPayloadContext | None,
    ) -> dict[str, Any] | None:
        if context is None or not context.extensions:
            return None

        if EIP2612_GAS_SPONSORING.key in context.extensions:
            eip2612 = self._try_build_eip2612_extension(requirements, payload)
            if eip2612:
                return {EIP2612_GAS_SPONSORING.key: {"info": eip2612, "schema": {}}}

        if TRC20_APPROVAL_GAS_SPONSORING.key in context.extensions:
            trc20 = self._try_build_trc20_approval_extension(requirements)
            if trc20:
                return {TRC20_APPROVAL_GAS_SPONSORING.key: {"info": trc20, "schema": {}}}

        return None

    def _try_build_eip2612_extension(
        self, requirements: PaymentRequirements, payload: dict[str, Any]
    ) -> dict[str, Any] | None:
        extra = requirements.extra or {}
        token_name = extra.get("name")
        token_version = extra.get("version")
        if not token_name or not token_version:
            return None

        permit2_auth = payload.get("permit2Authorization") or {}
        deadline = permit2_auth.get("deadline")
        if not deadline:
            return None

        token_address = requirements.asset
        permit2_address = PERMIT2_ADDRESSES.get(str(requirements.network))
        if not permit2_address:
            return None

        # Check if allowance is already sufficient
        try:
            allowance = self._signer.read_contract(
                address=token_address,
                function_name="allowance",
                args=[self._signer.address, permit2_address],
                abi=TRC20_ALLOWANCE_ABI,
            )
            if int(str(allowance)) >= int(str(requirements.amount)):
                return None
        except Exception:
            pass

        # Try to read nonces — if token doesn't support EIP-2612, this fails
        try:
            nonce = self._signer.read_contract(
                address=token_address,
                function_name="nonces",
                args=[self._signer.address],
                abi=EIP2612_NONCES_ABI,
            )
        except Exception:
            return None

        chain_id = get_tron_chain_id(str(requirements.network))
        domain = {
            "name": token_name,
            "version": token_version,
            "chainId": chain_id,
            "verifyingContract": normalize_address_for_signing(token_address),
        }
        message = {
            "owner": normalize_address_for_signing(self._signer.address),
            "spender": normalize_address_for_signing(permit2_address),
            "value": int(requirements.amount),
            "nonce": int(nonce),
            "deadline": int(deadline),
        }
        sig = self._signer.sign_typed_data(
            domain=domain,
            types=EIP2612_PERMIT_TYPES,
            primary_type="Permit",
            message=message,
        )

        return {
            "from": normalize_address_for_signing(self._signer.address),
            "asset": normalize_address_for_signing(token_address),
            "spender": normalize_address_for_signing(permit2_address),
            "amount": str(requirements.amount),
            "nonce": str(nonce),
            "deadline": str(deadline),
            "signature": sig,
            "version": "1",
        }

    def _try_build_trc20_approval_extension(
        self, requirements: PaymentRequirements
    ) -> dict[str, Any] | None:
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
            pass

        return sign_trc20_approval_transaction(
            self._signer,
            requirements.asset,
            str(requirements.network),
        )

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
            raise ValueError(
                f"No x402Permit2Proxy contract address configured for network {network}"
            )

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
        payload = ExactPermit2Payload(
            permit2_authorization=permit2_authorization, signature=signature
        )
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
