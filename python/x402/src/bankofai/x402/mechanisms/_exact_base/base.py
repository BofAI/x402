"""
Base classes for exact mechanism.

Provides ChainAdapter ABC and base Client/Facilitator/Server mechanisms
that delegate chain-specific operations to the adapter.
"""

import logging
import time
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from bankofai.x402.mechanisms._base.client import ClientMechanism
from bankofai.x402.mechanisms._base.facilitator import FacilitatorMechanism
from bankofai.x402.mechanisms._base.server import ServerMechanism
from bankofai.x402.mechanisms._exact_base.types import (
    SCHEME_EXACT,
    TRANSFER_AUTH_EIP712_TYPES,
    TransferAuthorization,
    build_eip712_domain,
    build_eip712_message,
    create_nonce,
    create_validity_window,
    get_transfer_with_authorization_abi_json,
)
from bankofai.x402.tokens import TokenRegistry
from bankofai.x402.types import (
    FeeInfo,
    FeeQuoteResponse,
    PaymentPayload,
    PaymentPayloadData,
    PaymentRequirements,
    PaymentRequirementsExtra,
    ResourceInfo,
    SettleResponse,
    VerifyResponse,
)

if TYPE_CHECKING:
    from bankofai.x402.signers.client import ClientSigner
    from bankofai.x402.signers.facilitator import FacilitatorSigner

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Chain adapter interface
# ---------------------------------------------------------------------------


class ChainAdapter(ABC):
    """Encapsulates chain-specific differences for exact."""

    @abstractmethod
    def parse_chain_id(self, network: str) -> int:
        """Extract chain ID from a network string."""

    @abstractmethod
    def validate_network(self, network: str) -> bool:
        """Return True if *network* is a valid identifier for this chain."""

    @abstractmethod
    def validate_address(self, address: str) -> bool:
        """Return True if *address* has the correct format for this chain."""

    @abstractmethod
    def normalize_address(self, address: str) -> str:
        """Normalize *address* for case-insensitive comparison."""

    @abstractmethod
    def to_signing_address(self, address: str) -> str:
        """Convert *address* to the EVM hex format used in EIP-712 signing."""


# ---------------------------------------------------------------------------
# Base client
# ---------------------------------------------------------------------------


class ExactBaseClientMechanism(ClientMechanism):
    """Base TransferWithAuthorization client mechanism."""

    def __init__(self, signer: "ClientSigner", adapter: ChainAdapter) -> None:
        self._signer = signer
        self._adapter = adapter

    def scheme(self) -> str:
        return SCHEME_EXACT

    def get_signer(self) -> "ClientSigner":
        return self._signer

    async def create_payment_payload(
        self,
        requirements: PaymentRequirements,
        resource: str,
        extensions: dict[str, Any] | None = None,
    ) -> PaymentPayload:
        """Create exact payment payload."""
        adapter = self._adapter

        from_addr = adapter.to_signing_address(self._signer.get_address())
        to_addr = adapter.to_signing_address(requirements.pay_to)
        value = requirements.amount
        token_address = requirements.asset

        # Look up token metadata for EIP-712 domain
        token_info = TokenRegistry.find_by_address(requirements.network, token_address)
        token_name = token_info.name if token_info else "Unknown Token"
        token_version = token_info.version if token_info else "1"

        # Create validity window and nonce
        valid_after, valid_before = create_validity_window()
        nonce = create_nonce()

        authorization = TransferAuthorization(
            **{
                "from": from_addr,
                "to": to_addr,
                "value": value,
                "validAfter": str(valid_after),
                "validBefore": str(valid_before),
                "nonce": nonce,
            }
        )

        # Build EIP-712 domain and message
        chain_id = adapter.parse_chain_id(requirements.network)
        domain = build_eip712_domain(
            token_name,
            token_version,
            chain_id,
            adapter.to_signing_address(token_address),
        )
        message = build_eip712_message(authorization)

        logger.info(
            "[EXACT] Signing TransferWithAuthorization: from=%s, to=%s, value=%s, token=%s",
            from_addr,
            to_addr,
            value,
            token_address,
        )

        signature = await self._signer.sign_typed_data(
            domain=domain,
            types=TRANSFER_AUTH_EIP712_TYPES,
            message=message,
        )

        return PaymentPayload(
            x402Version=2,
            resource=ResourceInfo(url=resource),
            accepted=requirements,
            payload=PaymentPayloadData(
                signature=signature,
            ),
            extensions={
                "transferAuthorization": authorization.model_dump(by_alias=True),
            },
        )


# ---------------------------------------------------------------------------
# Base facilitator
# ---------------------------------------------------------------------------


class ExactBaseFacilitatorMechanism(FacilitatorMechanism):
    """Base TransferWithAuthorization facilitator mechanism.

    Note: exact only supports a single transfer per authorization,
    so the facilitator cannot collect fees from the payment itself.
    fee_quote always returns feeAmount=0.
    """

    def __init__(
        self,
        signer: "FacilitatorSigner",
        adapter: ChainAdapter,
        allowed_tokens: set[str] | None = None,
    ) -> None:
        self._signer = signer
        self._adapter = adapter
        self._allowed_tokens: set[str] | None = (
            {adapter.normalize_address(t) for t in allowed_tokens}
            if allowed_tokens is not None
            else None
        )

    def scheme(self) -> str:
        return SCHEME_EXACT

    # ------------------------------------------------------------------
    # fee_quote
    # ------------------------------------------------------------------

    async def fee_quote(
        self,
        accept: PaymentRequirements,
        context: dict[str, Any] | None = None,
    ) -> FeeQuoteResponse | None:
        return FeeQuoteResponse(
            fee=FeeInfo(feeTo=self._signer.get_address(), feeAmount="0"),
            pricing="flat",
            scheme=accept.scheme,
            network=accept.network,
            asset=accept.asset,
            expires_at=int(time.time()) + 300,
        )

    # ------------------------------------------------------------------
    # verify
    # ------------------------------------------------------------------

    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        auth = self._extract_authorization(payload)
        if auth is None:
            return VerifyResponse(is_valid=False, invalid_reason="missing_transfer_authorization")

        error = self._validate_authorization(auth, requirements)
        if error:
            return VerifyResponse(is_valid=False, invalid_reason=error)

        is_valid = await self._verify_signature(auth, payload.payload.signature, requirements)
        if not is_valid:
            return VerifyResponse(is_valid=False, invalid_reason="invalid_signature")

        return VerifyResponse(is_valid=True)

    # ------------------------------------------------------------------
    # settle
    # ------------------------------------------------------------------

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        verify_result = await self.verify(payload, requirements)
        if not verify_result.is_valid:
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason,
                network=requirements.network,
            )

        auth = self._extract_authorization(payload)
        signature = payload.payload.signature

        # Split signature into v, r, s
        sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
        if len(sig_bytes) != 65:
            return SettleResponse(
                success=False,
                error_reason="invalid_signature_length",
                network=requirements.network,
            )
        r = sig_bytes[:32]
        s = sig_bytes[32:64]
        v = sig_bytes[64]
        if v < 27:
            v += 27

        nonce_bytes = bytes.fromhex(auth.nonce[2:] if auth.nonce.startswith("0x") else auth.nonce)

        adapter = self._adapter
        token_address = requirements.asset

        args = [
            adapter.to_signing_address(auth.from_address),
            adapter.to_signing_address(auth.to),
            int(auth.value),
            int(auth.valid_after),
            int(auth.valid_before),
            nonce_bytes,
            v,
            r,
            s,
        ]

        logger.info(
            "[EXACT] Calling transferWithAuthorization on token=%s",
            token_address,
        )

        tx_hash = await self._signer.write_contract(
            contract_address=token_address,
            abi=get_transfer_with_authorization_abi_json(),
            method="transferWithAuthorization",
            args=args,
            network=requirements.network,
        )

        if tx_hash is None:
            return SettleResponse(
                success=False,
                error_reason="transaction_failed",
                network=requirements.network,
            )

        receipt = await self._signer.wait_for_transaction_receipt(
            tx_hash, network=requirements.network
        )
        raw_status = receipt.get("status")
        tx_status = raw_status.lower() if isinstance(raw_status, str) else raw_status
        if tx_status == "failed" or tx_status == "0" or tx_status == 0:
            return SettleResponse(
                success=False,
                error_reason="transaction_failed_on_chain",
                transaction=tx_hash,
                network=requirements.network,
            )

        return SettleResponse(
            success=True,
            transaction=tx_hash,
            network=requirements.network,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_authorization(self, payload: PaymentPayload) -> TransferAuthorization | None:
        ext = payload.extensions or {}
        auth_data = ext.get("transferAuthorization")
        if auth_data is None:
            return None
        try:
            return TransferAuthorization(**auth_data)
        except Exception:
            return None

    def _validate_authorization(
        self,
        auth: TransferAuthorization,
        requirements: PaymentRequirements,
    ) -> str | None:
        adapter = self._adapter

        # Token whitelist
        if self._allowed_tokens is not None:
            if adapter.normalize_address(requirements.asset) not in self._allowed_tokens:
                return "token_not_allowed"

        # Amount check
        if int(auth.value) < int(requirements.amount):
            return "amount_mismatch"

        # Recipient check
        if adapter.normalize_address(auth.to) != adapter.normalize_address(requirements.pay_to):
            return "payto_mismatch"

        # Time window
        now = int(time.time())
        if int(auth.valid_before) < now:
            return "expired"
        if int(auth.valid_after) > now:
            return "not_yet_valid"

        return None

    async def _verify_signature(
        self,
        auth: TransferAuthorization,
        signature: str,
        requirements: PaymentRequirements,
    ) -> bool:
        adapter = self._adapter
        token_address = requirements.asset
        chain_id = adapter.parse_chain_id(requirements.network)

        token_info = TokenRegistry.find_by_address(requirements.network, token_address)
        token_name = token_info.name if token_info else "Unknown Token"
        token_version = token_info.version if token_info else "1"

        domain = build_eip712_domain(
            token_name,
            token_version,
            chain_id,
            adapter.to_signing_address(token_address),
        )
        message = build_eip712_message(auth)

        return await self._signer.verify_typed_data(
            address=adapter.to_signing_address(auth.from_address),
            domain=domain,
            types=TRANSFER_AUTH_EIP712_TYPES,
            message=message,
            signature=signature,
        )


# ---------------------------------------------------------------------------
# Base server
# ---------------------------------------------------------------------------


class ExactBaseServerMechanism(ServerMechanism):
    """Base TransferWithAuthorization server mechanism."""

    def __init__(self, adapter: ChainAdapter) -> None:
        self._adapter = adapter

    def scheme(self) -> str:
        return SCHEME_EXACT

    async def parse_price(self, price: str, network: str) -> dict[str, Any]:
        return TokenRegistry.parse_price(price, network)

    async def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        kind: str,
    ) -> PaymentRequirements:
        if requirements.extra is None:
            requirements.extra = PaymentRequirementsExtra()

        token = TokenRegistry.find_by_address(requirements.network, requirements.asset)
        if token:
            requirements.extra.name = token.name
            requirements.extra.version = token.version

        return requirements

    def validate_payment_requirements(self, requirements: PaymentRequirements) -> bool:
        adapter = self._adapter
        if not adapter.validate_network(requirements.network):
            return False
        if not adapter.validate_address(requirements.asset):
            return False
        if not adapter.validate_address(requirements.pay_to):
            return False
        try:
            if int(requirements.amount) <= 0:
                return False
        except ValueError:
            return False
        return True

    async def verify_signature(
        self,
        permit: Any,
        signature: str,
        network: str,
    ) -> bool:
        """Server-side signature check for exact.

        For exact, there is no PaymentPermit (permit is None).
        Full signature verification is delegated to the facilitator,
        which has access to the complete payload including extensions.
        The server simply passes through here.
        """
        return True
