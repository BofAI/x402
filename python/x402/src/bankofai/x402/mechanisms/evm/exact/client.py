"""EVM client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

import time
from datetime import timedelta
from typing import Any

from ....schemas import PaymentRequirements
from ..constants import (
    BALANCE_OF_ABI,
    ERC20_ALLOWANCE_ABI,
    ERC20_APPROVE_ABI,
    ERR_INSUFFICIENT_BALANCE,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    SCHEME_EXACT,
    X402_PERMIT2_PROXY_ADDRESSES,
)
from ..eip712 import build_typed_data_for_signing
from ..signer import ClientEvmSigner
from ..types import (
    ExactEIP3009Authorization,
    ExactEIP3009Payload,
    ExactPermit2Authorization,
    ExactPermit2Payload,
    Permit2Witness,
    TypedDataField,
)
from ..utils import (
    create_nonce,
    create_validity_window,
    get_asset_info,
    get_evm_chain_id,
    normalize_address,
)


def _wrap_if_local_account(signer: Any) -> ClientEvmSigner:
    """Auto-wrap eth_account LocalAccount in EthAccountSigner if needed."""
    try:
        from eth_account.signers.local import LocalAccount

        if isinstance(signer, LocalAccount):
            from ..signers import EthAccountSigner

            return EthAccountSigner(signer)
    except ImportError:
        pass
    return signer


class ExactEvmScheme:
    """EVM client implementation for the Exact payment scheme (V2).

    Implements SchemeNetworkClient protocol. Returns the inner payload dict,
    which x402Client wraps into a full PaymentPayload.

    Attributes:
        scheme: The scheme identifier ("exact").
    """

    scheme = SCHEME_EXACT

    def __init__(self, signer: ClientEvmSigner):
        """Create ExactEvmScheme.

        Args:
            signer: EVM signer for payment authorizations. Can also be an
                eth_account LocalAccount, which will be auto-wrapped in
                EthAccountSigner.
        """
        self._signer = _wrap_if_local_account(signer)

    def create_payment_payload(
        self,
        requirements: PaymentRequirements,
    ) -> dict[str, Any]:
        """Create signed EIP-3009 or Permit2 inner payload.

        Args:
            requirements: Payment requirements from server.

        Returns:
            Inner payload dict (authorization + signature).
            x402Client wraps this with x402_version, accepted, resource, extensions.
        """
        self._ensure_sufficient_balance(requirements)

        extra = requirements.extra or {}
        if extra.get("assetTransferMethod") == "permit2":
            return self._create_permit2_payload(requirements)

        nonce = create_nonce()
        valid_after, valid_before = create_validity_window(
            timedelta(seconds=requirements.max_timeout_seconds or 3600)
        )

        authorization = ExactEIP3009Authorization(
            from_address=self._signer.address,
            to=requirements.pay_to,
            value=requirements.amount,
            valid_after=str(valid_after),
            valid_before=str(valid_before),
            nonce=nonce,
        )

        signature = self._sign_authorization(authorization, requirements)

        payload = ExactEIP3009Payload(authorization=authorization, signature=signature)

        # Return inner payload dict - x402Client wraps this
        return payload.to_dict()

    def _sign_authorization(
        self,
        authorization: ExactEIP3009Authorization,
        requirements: PaymentRequirements,
    ) -> str:
        """Sign EIP-3009 authorization using EIP-712.

        Requires requirements.extra to contain 'name' and 'version'
        for the EIP-712 domain separator.

        Args:
            authorization: The authorization to sign.
            requirements: Payment requirements with EIP-712 domain info.

        Returns:
            Hex-encoded signature with 0x prefix.

        Raises:
            ValueError: If EIP-712 domain parameters are missing.
        """
        chain_id = get_evm_chain_id(str(requirements.network))

        extra = requirements.extra or {}
        if "name" not in extra:
            # Try to get from asset info
            try:
                asset_info = get_asset_info(str(requirements.network), requirements.asset)
                extra["name"] = asset_info["name"]
                extra["version"] = asset_info.get("version", "1")
            except ValueError:
                raise ValueError(
                    "EIP-712 domain parameters (name, version) required in extra"
                ) from None

        name = extra["name"]
        version = extra.get("version", "1")

        domain, types, primary_type, message = build_typed_data_for_signing(
            authorization,
            chain_id,
            requirements.asset,
            name,
            version,
        )

        # Convert types dict to match signer protocol
        typed_fields: dict[str, list[TypedDataField]] = {}
        for type_name, fields in types.items():
            typed_fields[type_name] = [
                TypedDataField(name=f["name"], type=f["type"]) for f in fields
            ]

        sig_bytes = self._signer.sign_typed_data(domain, typed_fields, primary_type, message)

        return "0x" + sig_bytes.hex()

    def _create_permit2_payload(self, requirements: PaymentRequirements) -> dict[str, Any]:
        """Create signed Permit2 payload."""
        network = str(requirements.network)
        permit2_address = PERMIT2_ADDRESSES.get(network)
        proxy_address = X402_PERMIT2_PROXY_ADDRESSES.get(network)
        if not permit2_address or not proxy_address:
            raise ValueError(f"No Permit2 configuration for network {network}")

        self._ensure_permit2_allowance(requirements, permit2_address)

        facilitator_address = (requirements.extra or {}).get("permit2FacilitatorAddress")
        if not facilitator_address:
            raise ValueError(
                "Permit2 facilitator address is required in payment requirements extra"
            )

        now = int(time.time())
        authorization = ExactPermit2Authorization(
            from_address=normalize_address(self._signer.address),
            permitted_token=normalize_address(requirements.asset),
            permitted_amount=str(requirements.amount),
            spender=normalize_address(proxy_address),
            nonce=create_nonce(),
            deadline=str(now + (requirements.max_timeout_seconds or 3600)),
            witness=Permit2Witness(
                to=normalize_address(requirements.pay_to),
                facilitator=normalize_address(str(facilitator_address)),
                valid_after=str(now - 600),
            ),
        )
        signature = self._sign_permit2(authorization, requirements, permit2_address)
        return ExactPermit2Payload(
            permit2_authorization=authorization, signature=signature
        ).to_dict()

    def _sign_permit2(
        self,
        authorization: ExactPermit2Authorization,
        requirements: PaymentRequirements,
        permit2_address: str,
    ) -> str:
        """Sign PermitWitnessTransferFrom typed data."""
        typed_fields: dict[str, list[TypedDataField]] = {}
        for type_name, fields in PERMIT2_WITNESS_TYPES.items():
            typed_fields[type_name] = [
                TypedDataField(name=f["name"], type=f["type"]) for f in fields
            ]

        domain = {
            "name": "Permit2",
            "chainId": get_evm_chain_id(str(requirements.network)),
            "verifyingContract": normalize_address(permit2_address),
        }
        message = {
            "permitted": {
                "token": normalize_address(authorization.permitted_token),
                "amount": int(authorization.permitted_amount),
            },
            "spender": normalize_address(authorization.spender),
            "nonce": int(str(authorization.nonce), 0),
            "deadline": int(authorization.deadline),
            "witness": {
                "to": normalize_address(authorization.witness.to),
                "facilitator": normalize_address(authorization.witness.facilitator),
                "validAfter": int(authorization.witness.valid_after),
            },
        }

        sig_bytes = self._signer.sign_typed_data(
            domain,
            typed_fields,
            "PermitWitnessTransferFrom",
            message,
        )
        return "0x" + sig_bytes.hex()

    def _ensure_sufficient_balance(self, requirements: PaymentRequirements) -> None:
        """Best-effort ERC-20 balance preflight.

        Runs only when the configured client signer exposes read_contract().
        """
        read_contract = getattr(self._signer, "read_contract", None)
        if not callable(read_contract):
            return

        try:
            balance = read_contract(
                requirements.asset,
                BALANCE_OF_ABI,
                "balanceOf",
                self._signer.address,
            )
        except NotImplementedError:
            return

        if int(balance) < int(requirements.amount):
            raise ValueError(
                f"{ERR_INSUFFICIENT_BALANCE}: Insufficient token balance. Required: {requirements.amount}, Available: {balance}"
            )

    def _ensure_permit2_allowance(
        self, requirements: PaymentRequirements, permit2_address: str
    ) -> None:
        """Best-effort local Permit2 approval fallback when sponsoring is unavailable."""
        read_contract = getattr(self._signer, "read_contract", None)
        if not callable(read_contract):
            return

        try:
            allowance = int(
                read_contract(
                    requirements.asset,
                    ERC20_ALLOWANCE_ABI,
                    "allowance",
                    self._signer.address,
                    permit2_address,
                )
            )
        except NotImplementedError:
            return
        if allowance >= int(requirements.amount):
            return

        write_contract = getattr(self._signer, "write_contract", None)
        wait_for_receipt = getattr(self._signer, "wait_for_transaction_receipt", None)
        if not callable(write_contract) or not callable(wait_for_receipt):
            return

        tx_hash = write_contract(
            requirements.asset,
            ERC20_APPROVE_ABI,
            "approve",
            permit2_address,
            (1 << 256) - 1,
        )
        receipt = wait_for_receipt(tx_hash)
        status = getattr(receipt, "status", None)
        if status is None and isinstance(receipt, dict):
            status = receipt.get("status")
        if status not in (1, "success"):
            raise ValueError(
                f"transaction_failed: local Permit2 approval failed with status={status}"
            )
