"""
ExactGasFreeClientMechanism - GasFree payment scheme client mechanism for TRON.
"""

import logging
import random
import time
from typing import TYPE_CHECKING, Any, Dict

from bankofai.x402.abi import GASFREE_PRIMARY_TYPE
from bankofai.x402.address.converter import TronAddressConverter
from bankofai.x402.config import NetworkConfig
from bankofai.x402.exceptions import GasFreeAccountNotActivated, InsufficientGasFreeBalance
from bankofai.x402.mechanisms._base.client import ClientMechanism
from bankofai.x402.tokens.registry import TokenRegistry
from bankofai.x402.types import (
    PAYMENT_ONLY,
    Fee,
    Payment,
    PaymentPayload,
    PaymentPayloadData,
    PaymentPermit,
    PaymentRequirements,
    PermitMeta,
    ResourceInfo,
)
from bankofai.x402.utils.gasfree import (
    GASFREE_TYPES,
    GasFreeAPIClient,
    get_gasfree_domain,
)

if TYPE_CHECKING:
    from bankofai.x402.signers.client.base import ClientSigner


class ExactGasFreeClientMechanism(ClientMechanism):
    """GasFree payment mechanism for TRON (USDT/USDD)"""

    def __init__(self, signer: "ClientSigner", clients: Dict[str, GasFreeAPIClient]) -> None:
        self._signer = signer
        self._clients = clients
        self._address_converter = TronAddressConverter()
        self._logger = logging.getLogger(self.__class__.__name__)

    def _get_api_client(self, network: str) -> GasFreeAPIClient:
        """Get API client for a specific network"""
        client = self._clients.get(network)
        if not client:
            from bankofai.x402.exceptions import UnsupportedNetworkError

            raise UnsupportedNetworkError(f"GasFree is not configured for network: {network}")
        return client

    def scheme(self) -> str:
        return "exact_gasfree"

    def get_signer(self) -> Any:
        return self._signer

    async def _check_gasfree_balance(
        self, token: str, network: str, account_info: dict | None = None
    ) -> int:
        if account_info is None:
            api_client = self._get_api_client(network)
            user_address = self._signer.get_address()
            account_info = await api_client.get_address_info(user_address)
        gasfree_address = account_info.get("gasFreeAddress")
        if not gasfree_address:
            raise RuntimeError(
                f"Could not retrieve GasFree address for {self._signer.get_address()}"
            )
        return await self._signer.check_balance(token, network, address=gasfree_address)

    async def check_balance(self, token: str, network: str) -> int:
        """Check balance in the gasfree wallet."""
        return await self._check_gasfree_balance(token, network)

    def _get_deadline_bounds(self, network: str) -> tuple[int, int]:
        if network == "tron:mainnet":
            # GasFree mainnet bounds: >= 50s, <= 600s. We add 5s to min and subtract 5s from max.
            return 55, 595
        # Non-mainnet bounds: >= 50s, <= 3600s. We add 5s to min and subtract 5s from max.
        return 55, 3595

    def _clamp_deadline(self, network: str, deadline_seconds: int) -> int:
        now = int(time.time())
        min_delta, max_delta = self._get_deadline_bounds(network)

        min_deadline = now + min_delta
        max_deadline = now + max_delta
        if deadline_seconds < min_deadline:
            raise ValueError(
                f"GasFree deadline too soon for {network}: {deadline_seconds} < {min_deadline}"
            )
        if deadline_seconds > max_deadline:
            self._logger.warning(
                "[GASFREE SIGN] deadline clamped: network=%s from=%d to=%d",
                network,
                deadline_seconds,
                max_deadline,
            )
            return max_deadline
        return deadline_seconds

    async def create_payment_payload(
        self,
        requirements: PaymentRequirements,
        resource: str,
        extensions: dict[str, Any] | None = None,
    ) -> PaymentPayload:
        """Create GasFree payment payload using official API for status checks and nonce"""
        network = requirements.network
        user_address = self._signer.get_address()
        api_client = self._get_api_client(network)

        # 1. Fetch account info
        self._logger.debug(f"Fetching account info for {user_address} from GasFree API...")
        account_info = await api_client.get_address_info(user_address)
        gasfree_address = account_info.get("gasFreeAddress")
        is_active = account_info.get("active", False)
        nonce = int(account_info.get("nonce", 0))

        if not gasfree_address:
            raise RuntimeError(f"Could not retrieve GasFree address for {user_address}")

        # 2. Check activation status
        # If active is False but allowSubmit is True, we can proceed
        # (e.g. for first-time activation)
        allow_submit = account_info.get("allowSubmit", False)
        if not is_active and not allow_submit:
            raise GasFreeAccountNotActivated(user_address, gasfree_address)

        # 3. Get provider and fee
        fee_info = requirements.extra.fee if requirements.extra else None
        if fee_info and fee_info.fee_to:
            # Use provider from facilitator's fee quote
            service_provider_addr = fee_info.fee_to
            self._logger.debug(f"Using GasFree provider from requirements: {service_provider_addr}")
        else:
            # Fallback: fetch providers from GasFree API directly
            self._logger.debug("No provider in requirements, fetching from GasFree API...")
            providers = await api_client.get_providers()
            if not providers:
                raise RuntimeError("No GasFree service providers available")
            service_provider_addr = random.choice(providers)["address"]
            self._logger.debug(f"Selected GasFree provider: {service_provider_addr}")

        # Look up per-user transferFee and activateFee from account info
        assets = account_info.get("assets", [])
        transfer_fee = 0
        activate_fee = 0
        target_token = self._address_converter.normalize(requirements.asset)

        for asset in assets:
            if asset.get("tokenAddress") == target_token:
                transfer_fee = int(asset.get("transferFee", 0))
                activate_fee = int(asset.get("activateFee", 0))
                break

        # Determine maxFee
        facilitator_fee = int(fee_info.fee_amount or "0") if fee_info else 0
        max_fee_val = max(transfer_fee, facilitator_fee)

        # Fallback: if both are 0 and no facilitator fee, default to 1 token
        if max_fee_val == 0 and not fee_info:
            token_info = TokenRegistry.find_by_address(network, requirements.asset)
            decimals = token_info.decimals if token_info else 6
            max_fee_val = 10**decimals

        # If the account is not yet activated, add activateFee to maxFee
        if not is_active and activate_fee > 0:
            max_fee_val = max_fee_val + activate_fee
            self._logger.debug(
                f"GasFree account not activated, adding activateFee {activate_fee} to maxFee"
            )
        max_fee = str(max_fee_val)

        # 4. Balance verification
        skip_balance_check = (extensions or {}).get("skipBalanceCheck", False)
        if not skip_balance_check:
            self._logger.debug(f"Verifying balance for {gasfree_address}...")
            asset_balance = await self._check_gasfree_balance(
                requirements.asset, network, account_info
            )
            required_total = int(requirements.amount) + max_fee_val
            if asset_balance < required_total:
                raise InsufficientGasFreeBalance(gasfree_address, required_total, asset_balance)

        _min_delta, max_delta = self._get_deadline_bounds(network)
        deadline_raw = (extensions or {}).get("paymentPermitContext", {}).get("meta", {}).get(
            "validBefore"
        ) or int(time.time()) + max_delta
        deadline = self._clamp_deadline(network, int(deadline_raw))

        self._logger.debug(f"[GASFREE] User Wallet: {user_address}")
        self._logger.debug(f"[GASFREE] GasFree Address: {gasfree_address}")
        self._logger.debug(f"[GASFREE] Token: {requirements.asset}")
        self._logger.debug(f"[GASFREE] Amount: {requirements.amount}")
        self._logger.debug(f"[GASFREE] Max Fee: {max_fee}")

        # 5. Sign TIP-712 Message
        self._logger.debug("Signing GasFree transaction with TIP-712...")
        chain_id = NetworkConfig.get_chain_id(network)
        controller = NetworkConfig.get_gasfree_controller_address(network)
        domain = get_gasfree_domain(chain_id, controller)

        signature = await self._signer.sign_typed_data(
            domain=domain,
            types=GASFREE_TYPES,
            message={
                "token": self._address_converter.to_evm_format(requirements.asset),
                "serviceProvider": self._address_converter.to_evm_format(service_provider_addr),
                "user": self._address_converter.to_evm_format(user_address),
                "receiver": self._address_converter.to_evm_format(requirements.pay_to),
                "value": int(requirements.amount),
                "maxFee": max_fee_val,
                "deadline": int(deadline),
                "version": 1,
                "nonce": nonce,
            },
            primary_type=GASFREE_PRIMARY_TYPE,
        )

        # 6. Pack into PaymentPayload
        permit = PaymentPermit(
            meta=PermitMeta(
                kind=PAYMENT_ONLY,
                paymentId=(extensions or {})
                .get("paymentPermitContext", {})
                .get("meta", {})
                .get("paymentId", ""),
                nonce=str(nonce),
                validAfter=(extensions or {})
                .get("paymentPermitContext", {})
                .get("meta", {})
                .get("validAfter", 0),
                validBefore=int(deadline),
            ),
            buyer=user_address,
            caller=service_provider_addr,  # Caller is the one who will submit (Relayer)
            payment=Payment(
                payToken=requirements.asset,
                payAmount=requirements.amount,
                payTo=requirements.pay_to,
            ),
            fee=Fee(
                feeTo=service_provider_addr,
                feeAmount=max_fee,
            ),
        )

        return PaymentPayload(
            x402Version=2,
            resource=ResourceInfo(url=resource, mimeType="application/json"),
            accepted=requirements,
            payload=PaymentPayloadData(
                signature=signature,
                merchantSignature=None,
                paymentPermit=permit,
            ),
            extensions={
                "gasfreeAddress": gasfree_address,
                "scheme": "exact_gasfree",
            },
        )
