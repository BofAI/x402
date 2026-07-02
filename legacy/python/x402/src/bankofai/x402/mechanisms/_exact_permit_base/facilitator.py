"""
BaseExactPermitFacilitatorMechanism - "exact_permit" facilitator base class.

Extracts common logic from EVM and TRON implementations.
"""

import logging
import time
from abc import abstractmethod
from typing import TYPE_CHECKING, Any

from bankofai.x402.abi import get_payment_permit_eip712_types
from bankofai.x402.address import AddressConverter
from bankofai.x402.config import NetworkConfig
from bankofai.x402.mechanisms._base.facilitator import FacilitatorMechanism
from bankofai.x402.tokens import TokenRegistry
from bankofai.x402.types import (
    KIND_MAP,
    FeeInfo,
    FeeQuoteResponse,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from bankofai.x402.utils import convert_permit_to_eip712_message, payment_id_to_bytes

if TYPE_CHECKING:
    from bankofai.x402.signers.facilitator import FacilitatorSigner

# Configuration constants
DEFAULT_BASE_FEE = 0
FEE_QUOTE_EXPIRY_SECONDS = 300


class BaseExactPermitFacilitatorMechanism(FacilitatorMechanism):
    """Base class for exact_permit payment scheme facilitator mechanisms.

    Subclasses only need to implement _get_address_converter() method.
    """

    def __init__(
        self,
        signer: "FacilitatorSigner",
        fee_to: str | None = None,
        base_fee: dict[str, int] | None = None,
        allowed_tokens: set[str] | None = None,
    ) -> None:
        self._signer = signer
        self._fee_to = fee_to or signer.get_address()
        self._caller = signer.get_address()
        self._address_converter = self._get_address_converter()
        self._base_fee_map: dict[str, int] = {}
        if base_fee:
            for symbol, fee in base_fee.items():
                upper = symbol.upper()
                if not TokenRegistry.get_network_tokens_by_symbol(upper):
                    raise ValueError(
                        f"Unknown token symbol '{symbol}' in base_fee. "
                        f"Available: {TokenRegistry.all_symbols()}"
                    )
                self._base_fee_map[upper] = fee
        self._allowed_tokens: set[str] | None = (
            {self._address_converter.normalize(t) for t in allowed_tokens}
            if allowed_tokens is not None
            else None
        )
        self._logger = logging.getLogger(self.__class__.__name__)
        self._logger.info(
            f"Initialized: fee_to={self._fee_to}, base_fee={self._base_fee_map}, "
            f"allowed_tokens={self._allowed_tokens}"
        )

    @abstractmethod
    def _get_address_converter(self) -> AddressConverter:
        """Get address converter, implemented by subclasses"""
        pass

    def scheme(self) -> str:
        return "exact_permit"

    def _get_base_fee(self, token_address: str, network: str) -> int | None:
        """Get base fee for a token address by looking up its symbol.

        Returns:
            Fee amount from base_fee_map, or None if the token is unknown
            or not configured in base_fee_map.
        """
        token_info = TokenRegistry.find_by_address(network, token_address)
        if token_info is None:
            return None
        symbol = token_info.symbol.upper()
        if symbol not in self._base_fee_map:
            return None
        return self._base_fee_map[symbol]

    async def fee_quote(
        self,
        accept: PaymentRequirements,
        context: dict[str, Any] | None = None,
    ) -> FeeQuoteResponse | None:
        """Calculate fee quote for a single payment requirement.

        Returns:
            FeeQuoteResponse, or None if the token is not supported.
        """
        base_fee = self._get_base_fee(accept.asset, accept.network)
        if base_fee is None:
            self._logger.warning(
                f"Unsupported token: asset={accept.asset}, network={accept.network}"
            )
            return None

        fee_amount = str(base_fee)
        self._logger.info(
            f"Fee quote requested: network={accept.network}, "
            f"amount={accept.amount}, fee={fee_amount}"
        )

        return FeeQuoteResponse(
            fee=FeeInfo(
                feeTo=self._fee_to,
                feeAmount=fee_amount,
                caller=self._caller,
            ),
            pricing="flat",
            scheme=accept.scheme,
            network=accept.network,
            asset=accept.asset,
            expires_at=int(time.time()) + FEE_QUOTE_EXPIRY_SECONDS,
        )

    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        """Verify payment signature"""
        permit = payload.payload.payment_permit
        if not permit:
            return VerifyResponse(is_valid=False, invalid_reason="missing_permit")

        self._logger.info(
            f"Verifying payment: paymentId={permit.meta.payment_id}, "
            f"buyer={permit.buyer}, amount={permit.payment.pay_amount}"
        )

        # Validate permit matches requirements
        validation_error = self._validate_permit(permit, requirements)
        if validation_error:
            self._logger.warning(f"Validation failed: {validation_error}")
            return VerifyResponse(is_valid=False, invalid_reason=validation_error)

        # Verify EIP-712 signature
        self._logger.info("Verifying EIP-712 signature...")
        is_valid = await self._verify_signature(
            permit, payload.payload.signature, requirements.network
        )
        if not is_valid:
            self._logger.warning("Invalid signature")
            return VerifyResponse(is_valid=False, invalid_reason="invalid_signature")

        self._logger.info("Payment verification successful")
        return VerifyResponse(is_valid=True)

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """Execute payment settlement"""
        permit = payload.payload.payment_permit
        self._logger.info(
            f"Starting settlement: paymentId={permit.meta.payment_id}, "
            f"kind={permit.meta.kind}, network={requirements.network}"
        )

        # Verify first
        verify_result = await self.verify(payload, requirements)
        if not verify_result.is_valid:
            self._logger.error(
                f"Settlement failed: verification failed - {verify_result.invalid_reason}"
            )
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason,
                network=requirements.network,
            )

        signature = payload.payload.signature

        # Always use payment only settlement
        self._logger.info("Settling payment only via PaymentPermit contract...")
        self._logger.info("Settlement details:")
        self._logger.info(f"  - buyer: {permit.buyer}")
        self._logger.info(f"  - payTo: {permit.payment.pay_to}")
        self._logger.info(f"  - payToken: {permit.payment.pay_token}")
        self._logger.info(f"  - payAmount: {permit.payment.pay_amount}")
        self._logger.info(f"  - feeTo: {permit.fee.fee_to}")
        self._logger.info(f"  - feeAmount: {permit.fee.fee_amount}")

        tx_hash = await self._settle_payment_only(permit, signature, requirements)

        if tx_hash is None:
            self._logger.error("Settlement transaction failed: no transaction hash returned")
            self._logger.error("This usually indicates:")
            self._logger.error("  - Insufficient bandwidth/energy on the facilitator account")
            self._logger.error("  - Insufficient TRX balance to pay for transaction fees")
            self._logger.error("  - Network connectivity issues")
            self._logger.error("  - Contract execution error (check contract address and ABI)")
            return SettleResponse(
                success=False,
                error_reason="transaction_failed",
                network=requirements.network,
            )

        self._logger.info(f"Transaction broadcast successful: txHash={tx_hash}")
        self._logger.info("Waiting for transaction receipt...")
        receipt = await self._signer.wait_for_transaction_receipt(
            tx_hash, network=requirements.network
        )
        self._logger.info(f"Transaction confirmed: {receipt}")

        # Validate transaction status
        tx_status = receipt.get("status", "").lower()
        if tx_status == "failed" or tx_status == "0" or tx_status == 0:
            self._logger.error(f"Transaction failed on-chain: txHash={tx_hash}, receipt={receipt}")
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

    def _validate_permit(self, permit: Any, requirements: PaymentRequirements) -> str | None:
        """Validate permit matches requirements, returns error reason or None"""
        norm = self._address_converter.normalize

        # Token whitelist check - reject unsupported tokens before any other validation
        if self._allowed_tokens is not None:
            if norm(permit.payment.pay_token) not in self._allowed_tokens:
                self._logger.warning(
                    f"Token not allowed: {permit.payment.pay_token} not in {self._allowed_tokens}"
                )
                return "token_not_allowed"

        if int(permit.payment.pay_amount) < int(requirements.amount):
            self._logger.warning(
                f"Amount mismatch: {permit.payment.pay_amount} < {requirements.amount}"
            )
            return "amount_mismatch"

        # Address comparison (normalize to handle hex/Base58 mixed inputs)
        if norm(permit.payment.pay_to) != norm(requirements.pay_to):
            self._logger.warning(
                f"PayTo mismatch: {permit.payment.pay_to} != {requirements.pay_to}"
            )
            return "payto_mismatch"

        if norm(permit.payment.pay_token) != norm(requirements.asset):
            self._logger.warning(
                f"Token mismatch: {permit.payment.pay_token} != {requirements.asset}"
            )
            return "token_mismatch"

        # Fee validation: compare against facilitator's own configured fee
        if norm(permit.fee.fee_to) != norm(self._fee_to):
            self._logger.warning(f"FeeTo mismatch: {permit.fee.fee_to} != {self._fee_to}")
            return "fee_to_mismatch"
        expected_fee = self._get_base_fee(permit.payment.pay_token, requirements.network)
        if expected_fee is None:
            self._logger.warning(
                f"Unsupported token for fee: {permit.payment.pay_token} on {requirements.network}"
            )
            return "unsupported_token"
        if int(permit.fee.fee_amount) < expected_fee:
            self._logger.warning(f"FeeAmount too low: {permit.fee.fee_amount} < {expected_fee}")
            return "fee_amount_mismatch"

        now = int(time.time())
        if permit.meta.valid_before < now:
            self._logger.warning(
                f"Permit expired: validBefore={permit.meta.valid_before} < now={now}"
            )
            return "expired"

        if permit.meta.valid_after > now:
            self._logger.warning(
                f"Permit not yet valid: validAfter={permit.meta.valid_after} > now={now}"
            )
            return "not_yet_valid"

        return None

    async def _verify_signature(
        self,
        permit: Any,
        signature: str,
        network: str,
    ) -> bool:
        """Verify EIP-712 signature"""
        permit_address = NetworkConfig.get_payment_permit_address(network)
        chain_id = NetworkConfig.get_chain_id(network)
        converter = self._address_converter

        message = convert_permit_to_eip712_message(permit)
        message = converter.convert_message_addresses(message)

        # Debug: log exact message being verified
        import logging

        logger = logging.getLogger(__name__)
        logger.info(
            "[VERIFY] Domain: name=PaymentPermit, chainId=%s, verifyingContract=%s",
            chain_id,
            converter.to_evm_format(permit_address),
        )
        # Log paymentId as hex for comparison with TypeScript
        msg_copy = dict(message)
        if "meta" in msg_copy and "paymentId" in msg_copy["meta"]:
            pid = msg_copy["meta"]["paymentId"]
            if isinstance(pid, bytes):
                msg_copy["meta"] = dict(msg_copy["meta"])
                msg_copy["meta"]["paymentId"] = "0x" + pid.hex()
        logger.info(f"[VERIFY] Message: {msg_copy}")
        logger.info(f"[VERIFY] Signature: {signature}")
        logger.info(f"[VERIFY] Buyer address: {permit.buyer}")

        from bankofai.x402.abi import PAYMENT_PERMIT_PRIMARY_TYPE

        return await self._signer.verify_typed_data(
            address=permit.buyer,
            domain={
                "name": "PaymentPermit",
                "chainId": chain_id,
                "verifyingContract": converter.to_evm_format(permit_address),
            },
            types=get_payment_permit_eip712_types(),
            message=message,
            signature=signature,
            primary_type=PAYMENT_PERMIT_PRIMARY_TYPE,
        )

    @abstractmethod
    async def _settle_payment_only(
        self,
        permit: Any,
        signature: str,
        requirements: PaymentRequirements,
    ) -> str | None:
        """Payment only settlement (no on-chain delivery), implemented by subclasses"""
        pass

    def _build_permit_tuple(self, permit: Any) -> tuple:
        """Build permit tuple for contract call"""
        converter = self._address_converter

        payment_id = permit.meta.payment_id
        if isinstance(payment_id, str):
            payment_id = payment_id_to_bytes(payment_id)

        buyer = converter.normalize(permit.buyer)
        caller = converter.normalize(permit.caller)
        pay_token = converter.normalize(permit.payment.pay_token)
        pay_to = converter.normalize(permit.payment.pay_to)
        fee_to = converter.normalize(permit.fee.fee_to)

        return (
            (  # meta tuple
                KIND_MAP.get(permit.meta.kind, 0),
                payment_id,
                int(permit.meta.nonce),
                permit.meta.valid_after,
                permit.meta.valid_before,
            ),
            buyer,
            caller,
            (pay_token, int(permit.payment.pay_amount), pay_to),
            (fee_to, int(permit.fee.fee_amount)),
        )
