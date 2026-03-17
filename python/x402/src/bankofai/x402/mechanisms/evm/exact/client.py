"""EVM client implementation for the Exact payment scheme (V2)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from ....schemas import PaymentRequirements
from ....interfaces import PaymentPayloadContext
from ....extensions.eip2612_gas_sponsoring import EIP2612_GAS_SPONSORING
from ....extensions.erc20_approval_gas_sponsoring import ERC20_APPROVAL_GAS_SPONSORING
from ..constants import (
    DEFAULT_MAX_FEE_PER_GAS,
    DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
    EIP2612_NONCES_ABI,
    EIP2612_PERMIT_TYPES,
    ERC20_ALLOWANCE_ABI,
    ERC20_APPROVE_GAS_LIMIT,
    SCHEME_EXACT,
    get_permit2_address,
)
from ..eip712 import build_typed_data_for_signing
from ..signer import ClientEvmSigner
from ..types import ExactEIP3009Authorization, ExactEIP3009Payload, TypedDataField
from ..utils import (
    create_nonce,
    create_validity_window,
    get_asset_info,
    get_evm_chain_id,
)
from .permit2 import create_permit2_payload


def _wrap_if_local_account(signer: Any) -> ClientEvmSigner:
    """Auto-wrap eth_account LocalAccount in EthAccountSigner if needed."""
    try:
        from eth_account.signers.local import LocalAccount

        if isinstance(signer, LocalAccount):
            from ..signers import EthAccountSigner
            import os

            rpc_url = (
                os.environ.get("EVM_RPC_URL")
                or os.environ.get("WEB3_PROVIDER_URL")
                or "https://bsc-testnet-rpc.publicnode.com"
            )
            return EthAccountSigner(signer, rpc_url=rpc_url)
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

        # If signer is EthAccountSigner without RPC, approval extension will be unavailable.

    def create_payment_payload(
        self,
        requirements: PaymentRequirements,
        context: PaymentPayloadContext | None = None,
    ) -> dict[str, Any] | tuple[dict[str, Any], dict[str, Any]]:
        """Create signed EIP-3009 inner payload.

        Args:
            requirements: Payment requirements from server.

        Returns:
            Inner payload dict (authorization + signature).
            x402Client wraps this with x402_version, accepted, resource, extensions.
        """
        extra = requirements.extra or {}
        asset_transfer_method = extra.get("assetTransferMethod", "eip3009")
        if asset_transfer_method == "permit2":
            payload = create_permit2_payload(self._signer, requirements)
            extensions = _try_build_gas_sponsoring_extensions(
                self._signer, requirements, payload, context
            )
            if extensions:
                return payload, extensions
            return payload

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


def _try_build_gas_sponsoring_extensions(
    signer: ClientEvmSigner,
    requirements: PaymentRequirements,
    payload: dict[str, Any],
    context: PaymentPayloadContext | None,
) -> dict[str, Any] | None:
    if context is None or not context.extensions:
        return None

    if EIP2612_GAS_SPONSORING.key in context.extensions:
        eip2612 = _try_build_eip2612_extension(signer, requirements, payload)
        if eip2612:
            return {EIP2612_GAS_SPONSORING.key: {"info": eip2612, "schema": {}}}

    if ERC20_APPROVAL_GAS_SPONSORING.key in context.extensions:
        erc20 = _try_build_erc20_approval_extension(signer, requirements)
        if erc20:
            return {ERC20_APPROVAL_GAS_SPONSORING.key: {"info": erc20, "schema": {}}}

    return None


def _try_build_eip2612_extension(
    signer: ClientEvmSigner,
    requirements: PaymentRequirements,
    payload: dict[str, Any],
) -> dict[str, Any] | None:
    if not hasattr(signer, "read_contract"):
        return None
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
    permit2_address = get_permit2_address(str(requirements.network))
    try:
        allowance = signer.read_contract(
            token_address, ERC20_ALLOWANCE_ABI, "allowance", signer.address, permit2_address
        )
        if int(allowance) >= int(requirements.amount):
            return None
    except Exception:
        pass
    try:
        nonce = signer.read_contract(token_address, EIP2612_NONCES_ABI, "nonces", signer.address)
    except Exception:
        return None

    chain_id = get_evm_chain_id(str(requirements.network))
    domain = {
        "name": token_name,
        "version": token_version,
        "chainId": chain_id,
        "verifyingContract": token_address,
    }
    message = {
        "owner": signer.address,
        "spender": permit2_address,
        "value": int(requirements.amount),
        "nonce": int(nonce),
        "deadline": int(deadline),
    }
    sig = signer.sign_typed_data(
        domain=domain,
        types={k: [TypedDataField(name=f["name"], type=f["type"]) for f in v] for k, v in EIP2612_PERMIT_TYPES.items()},
        primary_type="Permit",
        message=message,
    )

    return {
        "from": signer.address,
        "asset": token_address,
        "spender": permit2_address,
        "amount": str(requirements.amount),
        "nonce": str(nonce),
        "deadline": str(deadline),
        "signature": "0x" + sig.hex(),
        "version": "1",
    }


def _try_build_erc20_approval_extension(
    signer: ClientEvmSigner,
    requirements: PaymentRequirements,
) -> dict[str, Any] | None:
    if not hasattr(signer, "sign_transaction") or not hasattr(signer, "get_transaction_count"):
        return None

    token_address = requirements.asset
    permit2_address = get_permit2_address(str(requirements.network))
    # Best-effort allowance check if available
    if hasattr(signer, "read_contract"):
        try:
            allowance = signer.read_contract(
                token_address, ERC20_ALLOWANCE_ABI, "allowance", signer.address, permit2_address
            )
            if int(allowance) >= int(requirements.amount):
                return None
        except Exception:
            pass

    data = _encode_erc20_approve(permit2_address)
    nonce = signer.get_transaction_count(signer.address)
    chain_id = get_evm_chain_id(str(requirements.network))
    tx = {
        "to": token_address,
        "data": data,
        "value": 0,
        "nonce": nonce,
        "gas": ERC20_APPROVE_GAS_LIMIT,
        "maxFeePerGas": DEFAULT_MAX_FEE_PER_GAS,
        "maxPriorityFeePerGas": DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
        "chainId": chain_id,
    }
    signed = signer.sign_transaction(tx)
    signed_hex = _normalize_signed_tx(signed)
    return {
        "from": signer.address,
        "asset": token_address,
        "spender": permit2_address,
        "amount": str(2**256 - 1),
        "signedTransaction": signed_hex,
        "version": "1",
    }


def _encode_erc20_approve(spender: str) -> str:
    try:
        from eth_abi import encode
        from eth_utils import keccak

        selector = keccak(text="approve(address,uint256)")[:4]
        data = encode(["address", "uint256"], [spender, 2**256 - 1])
        return "0x" + (selector + data).hex()
    except Exception as e:
        raise ValueError(f"failed to encode approve: {e}") from e


def _normalize_signed_tx(signed: Any) -> str:
    if isinstance(signed, bytes):
        return "0x" + signed.hex()
    if isinstance(signed, str):
        return signed if signed.startswith("0x") else "0x" + signed
    raw = getattr(signed, "rawTransaction", None)
    if raw is not None:
        if isinstance(raw, bytes):
            return "0x" + raw.hex()
        if isinstance(raw, str):
            return raw if raw.startswith("0x") else "0x" + raw
    raise ValueError("Unsupported signed transaction format")
