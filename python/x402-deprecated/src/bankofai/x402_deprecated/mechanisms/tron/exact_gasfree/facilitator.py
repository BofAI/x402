"""
ExactGasFreeFacilitatorMechanism - GasFree payment scheme facilitator mechanism for TRON.
"""

import random
import time
from typing import Any, Dict, Optional

from bankofai.x402_deprecated.abi import GASFREE_PRIMARY_TYPE
from bankofai.x402_deprecated.address.converter import AddressConverter, TronAddressConverter
from bankofai.x402_deprecated.config import NetworkConfig
from bankofai.x402_deprecated.mechanisms._exact_permit_base.facilitator import (
    FEE_QUOTE_EXPIRY_SECONDS,
    BaseExactPermitFacilitatorMechanism,
)
from bankofai.x402_deprecated.types import (
    FeeInfo,
    FeeQuoteResponse,
    PaymentPayload,
    PaymentPermit,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)
from bankofai.x402_deprecated.utils.gasfree import (
    GASFREE_TYPES,
    GasFreeAPIClient,
    get_gasfree_domain,
)


class ExactGasFreeFacilitatorMechanism(BaseExactPermitFacilitatorMechanism):
    """GasFree facilitator mechanism for TRON (API Proxy mode)"""

    def __init__(
        self,
        signer: Any,
        clients: Dict[str, GasFreeAPIClient],
        fee_to: str | None = None,
        base_fee: dict[str, int] | None = None,
        allowed_tokens: set[str] | None = None,
    ) -> None:
        super().__init__(signer, fee_to, base_fee, allowed_tokens)
        self._clients = clients

    def _get_api_client(self, network: str) -> GasFreeAPIClient:
        """Get API client for a specific network"""
        client = self._clients.get(network)
        if not client:
            from bankofai.x402_deprecated.exceptions import UnsupportedNetworkError

            raise UnsupportedNetworkError(f"GasFree is not configured for network: {network}")
        return client

    def scheme(self) -> str:
        return "exact_gasfree"

    def _get_address_converter(self) -> AddressConverter:
        return TronAddressConverter()

    async def fee_quote(
        self,
        accept: PaymentRequirements,
        context: dict[str, Any] | None = None,
    ) -> FeeQuoteResponse | None:
        """Override fee_quote to select a random GasFree provider.

        Uses base_fee for feeAmount (same as parent), but selects a GasFree
        provider as feeTo/caller instead of the facilitator's own address.
        """
        base_fee = self._get_base_fee(accept.asset, accept.network)
        if base_fee is None:
            self._logger.warning(
                f"Unsupported token: asset={accept.asset}, network={accept.network}"
            )
            return None

        network = accept.network
        api_client = self._get_api_client(network)

        providers = await api_client.get_providers()
        if not providers:
            self._logger.warning("No GasFree providers available")
            return None

        selected = random.choice(providers)
        provider_addr = selected["address"]
        fee_amount = str(base_fee)

        self._logger.info(
            f"GasFree fee_quote: provider={provider_addr}, "
            f"fee={fee_amount}, network={network}, asset={accept.asset}"
        )

        # In GasFree, the service provider relays the transaction,
        # so feeTo and caller both point to the provider address.
        return FeeQuoteResponse(
            fee=FeeInfo(
                feeTo=provider_addr,
                feeAmount=fee_amount,
                caller=provider_addr,
            ),
            pricing="flat",
            scheme=accept.scheme,
            network=network,
            asset=accept.asset,
            expires_at=int(time.time()) + FEE_QUOTE_EXPIRY_SECONDS,
        )

    async def _validate_permit_async(
        self, permit: PaymentPermit, requirements: PaymentRequirements
    ) -> str | None:
        """
        Specialized validation for GasFree.

        GasFree signed fields → PaymentPermit mapping:
          token → pay_token, value → pay_amount, receiver → pay_to,
          serviceProvider → fee_to, maxFee → fee_amount, deadline → valid_before,
          nonce → nonce.
        Fields NOT in GasFree: validAfter, paymentId, kind.
        """
        norm = self._address_converter.normalize

        # Token whitelist check (facilitator config)
        if self._allowed_tokens is not None:
            if norm(permit.payment.pay_token) not in self._allowed_tokens:
                self._logger.warning(
                    f"Token not allowed: {permit.payment.pay_token} not in {self._allowed_tokens}"
                )
                return "token_not_allowed"

        # value >= required amount
        if int(permit.payment.pay_amount) < int(requirements.amount):
            return "amount_mismatch"

        # token must match
        if norm(permit.payment.pay_token) != norm(requirements.asset):
            return "token_mismatch"

        # receiver must match merchant
        if norm(permit.payment.pay_to) != norm(requirements.pay_to):
            self._logger.warning(
                f"Merchant mismatch: {permit.payment.pay_to} != {requirements.pay_to}"
            )
            return "payto_mismatch"

        # serviceProvider must be a valid GasFree provider
        network = requirements.network
        api_client = self._get_api_client(network)

        try:
            providers = await api_client.get_providers()
            allowed_providers = {norm(p["address"]) for p in providers}

            fee_to_norm = norm(permit.fee.fee_to)
            if fee_to_norm not in allowed_providers:
                self._logger.warning(f"Provider {permit.fee.fee_to} is not in allowed list")
                return "fee_to_mismatch"
        except Exception as e:
            self._logger.error(f"Failed to fetch providers for validation from API: {e}")
            # Fallback to self._fee_to if API fails
            if norm(permit.fee.fee_to) != norm(self._fee_to):
                return "fee_to_mismatch"

        # maxFee must be >= configured base_fee
        expected_fee = self._get_base_fee(permit.payment.pay_token, requirements.network)
        if expected_fee is None:
            self._logger.warning(
                f"Unsupported token for fee: {permit.payment.pay_token} on {requirements.network}"
            )
            return "unsupported_token"
        if int(permit.fee.fee_amount) < expected_fee:
            self._logger.warning(f"FeeAmount too low: {permit.fee.fee_amount} < {expected_fee}")
            return "fee_amount_mismatch"

        # deadline must not have passed
        now = int(time.time())
        if permit.meta.valid_before < now:
            self._logger.warning(
                f"Deadline passed: deadline={permit.meta.valid_before} < now={now}"
            )
            return "expired"

        # Note: GasFree has no validAfter concept, so no not_yet_valid check.

        return None

    async def verify(
        self, payload: PaymentPayload, requirements: PaymentRequirements
    ) -> VerifyResponse:
        """Override verify to use async validation"""
        permit = payload.payload.payment_permit
        if not permit:
            return VerifyResponse(is_valid=False, invalid_reason="missing_permit")

        reason = await self._validate_permit_async(permit, requirements)
        if reason:
            return VerifyResponse(is_valid=False, invalid_reason=reason)

        # Signature verification
        is_valid_sig = await self._verify_signature(
            permit, payload.payload.signature, requirements.network
        )
        if not is_valid_sig:
            return VerifyResponse(is_valid=False, invalid_reason="invalid_signature")

        return VerifyResponse(is_valid=True, invalid_reason=None)

    async def _verify_signature(
        self,
        permit: PaymentPermit,
        signature: str,
        network: str,
    ) -> bool:
        """Verify GasFree TIP-712 signature locally before forwarding"""
        controller = NetworkConfig.get_gasfree_controller_address(network)
        chain_id = NetworkConfig.get_chain_id(network)
        converter = self._address_converter

        # Reconstruct GasFree message from the mapped permit
        message = {
            "token": converter.to_evm_format(permit.payment.pay_token),
            "serviceProvider": converter.to_evm_format(permit.fee.fee_to),
            "user": converter.to_evm_format(permit.buyer),
            "receiver": converter.to_evm_format(permit.payment.pay_to),
            "value": int(permit.payment.pay_amount),
            "maxFee": int(permit.fee.fee_amount),
            "deadline": int(permit.meta.valid_before),
            "version": 1,
            "nonce": int(permit.meta.nonce),
        }

        domain = get_gasfree_domain(chain_id, controller)

        self._logger.debug(f"[VERIFY GASFREE] Domain: {domain}")
        self._logger.debug(f"[VERIFY GASFREE] Message: {message}")

        return await self._signer.verify_typed_data(
            address=permit.buyer,
            domain=domain,
            types=GASFREE_TYPES,
            message=message,
            signature=signature,
            primary_type=GASFREE_PRIMARY_TYPE,
        )

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """
        Specialized settle for GasFree: Settle via API and wait for result.
        """
        # 1. Validation (re-run verify to ensure consistency)
        verify_result = await self.verify(payload, requirements)
        if not verify_result.is_valid:
            return SettleResponse(
                success=False,
                error_reason=verify_result.invalid_reason or "verification_failed",
                network=requirements.network,
            )

        # 2. Extract permit and signature
        permit = payload.payload.payment_permit
        signature = payload.payload.signature
        gasfree_address = (payload.extensions or {}).get("gasfreeAddress")

        if not permit or not signature or not gasfree_address:
            return SettleResponse(
                success=False,
                error_reason="missing_payload_data",
                network=requirements.network,
            )

        # 3. Final balance check before submission
        try:
            asset_balance = await self._signer.check_balance(
                requirements.asset, requirements.network, address=gasfree_address
            )
            required_total = int(requirements.amount) + int(permit.fee.fee_amount)
            if asset_balance < required_total:
                return SettleResponse(
                    success=False,
                    error_reason=f"insufficient balance in gasfree wallet {gasfree_address}",
                    network=requirements.network,
                )
        except Exception as e:
            self._logger.warning(f"Final balance check failed: {e}")

        self._logger.info(f"Starting GasFree API settlement: paymentId={permit.meta.payment_id}")

        # 3. Call API Proxy and Wait
        network = requirements.network
        api_client = self._get_api_client(network)

        try:
            # Submit
            trace_id = await self._settle_payment_only(permit, signature, requirements)
            if not trace_id:
                return SettleResponse(
                    success=False,
                    error_reason="api_no_response",
                    network=requirements.network,
                )

            self._logger.info(f"GasFree submitted. Trace ID: {trace_id}. Polling for result...")

            # Wait for success (like wait_for_transaction_receipt)
            result_data = await api_client.wait_for_success(trace_id)

            # 4. Return success with the ACTUAL TRON transaction hash if available
            txn_hash = result_data.get("txnHash")
            if not txn_hash:
                self._logger.error(
                    f"GasFree polling returned success but txnHash is missing for {trace_id}"
                )
                return SettleResponse(
                    success=False,
                    error_reason="missing_transaction_hash",
                    network=requirements.network,
                )

            self._logger.info(
                f"GasFree settlement successful. State: {result_data.get('state')}, "
                f"Hash: {txn_hash}"
            )

            return SettleResponse(
                success=True,
                transaction=txn_hash,
                network=requirements.network,
            )
        except Exception as e:
            self._logger.error(
                f"GasFree settlement or wait failed for network {network}: {e}", exc_info=True
            )
            return SettleResponse(
                success=False,
                error_reason=str(e),
                network=requirements.network,
            )

    async def _settle_payment_only(
        self,
        permit: PaymentPermit,
        signature: str,
        requirements: PaymentRequirements,
    ) -> Optional[str]:
        """Internal helper for API submission"""
        network = requirements.network
        controller = NetworkConfig.get_gasfree_controller_address(network)
        chain_id = NetworkConfig.get_chain_id(network)
        api_client = self._get_api_client(network)

        # Build the message for the API.
        # Note: GasFree API requires TRON Base58 addresses in the payload body,
        # while the signature (TIP-712) uses EVM hex format.
        message = {
            "token": permit.payment.pay_token,
            "serviceProvider": permit.fee.fee_to,
            "user": permit.buyer,
            "receiver": permit.payment.pay_to,
            "value": str(permit.payment.pay_amount),
            "maxFee": str(permit.fee.fee_amount),
            "deadline": str(permit.meta.valid_before),
            "version": 1,
            "nonce": int(permit.meta.nonce),
        }

        domain = get_gasfree_domain(chain_id, controller)

        self._logger.debug("Settling GasFree via Official HTTP API Proxy...")

        return await api_client.submit(domain=domain, message=message, signature=signature)
