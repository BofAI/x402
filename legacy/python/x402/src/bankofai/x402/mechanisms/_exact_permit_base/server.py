"""
BaseExactPermitServerMechanism - Base class for "exact_permit" payment scheme server mechanisms.

Extracts common logic from EVM and TRON implementations.
"""

import logging
from abc import abstractmethod
from typing import Any

from bankofai.x402.abi import (
    PAYMENT_PERMIT_PRIMARY_TYPE,
    get_payment_permit_eip712_types,
)
from bankofai.x402.config import NetworkConfig
from bankofai.x402.mechanisms._base.server import ServerMechanism
from bankofai.x402.tokens import TokenRegistry
from bankofai.x402.types import KIND_MAP, PaymentRequirements, PaymentRequirementsExtra


class BaseExactPermitServerMechanism(ServerMechanism):
    """Base class for exact_permit payment scheme server mechanisms.

    Subclasses only need to implement network prefix and address format validation.
    """

    def __init__(self) -> None:
        self._logger = logging.getLogger(self.__class__.__name__)

    @abstractmethod
    def _get_network_prefix(self) -> str:
        """Get network prefix, implemented by subclasses (e.g., 'eip155:' or 'tron:')"""
        pass

    @abstractmethod
    def _validate_address_format(self, address: str) -> bool:
        """Validate address format, implemented by subclasses"""
        pass

    def scheme(self) -> str:
        return "exact_permit"

    async def parse_price(self, price: str, network: str) -> dict[str, Any]:
        """Parse price string to asset amount.

        Args:
            price: Price string (e.g., "100 USDC")
            network: Network identifier

        Returns:
            Dict containing amount, asset, decimals, etc.
        """
        self._logger.debug(f"Parsing price: {price} on network {network}")
        return TokenRegistry.parse_price(price, network)

    async def enhance_payment_requirements(
        self,
        requirements: PaymentRequirements,
        kind: str,
    ) -> PaymentRequirements:
        """Enhance payment requirements with token metadata"""
        if requirements.extra is None:
            requirements.extra = PaymentRequirementsExtra()

        token = TokenRegistry.find_by_address(requirements.network, requirements.asset)
        if token:
            requirements.extra.name = token.name
            requirements.extra.version = token.version

        return requirements

    def validate_payment_requirements(self, requirements: PaymentRequirements) -> bool:
        """Validate payment requirements"""
        prefix = self._get_network_prefix()

        if not requirements.network.startswith(prefix):
            self._logger.warning(f"Invalid network prefix: {requirements.network}")
            return False

        if not self._validate_address_format(requirements.asset):
            self._logger.warning(f"Invalid asset address format: {requirements.asset}")
            return False

        if not self._validate_address_format(requirements.pay_to):
            self._logger.warning(f"Invalid payTo address format: {requirements.pay_to}")
            return False

        try:
            amount = int(requirements.amount)
            if amount <= 0:
                self._logger.warning(f"Invalid amount: {amount}")
                return False
        except ValueError:
            self._logger.warning(f"Amount is not a valid integer: {requirements.amount}")
            return False

        return True

    async def verify_signature(
        self,
        permit: Any,
        signature: str,
        network: str,
    ) -> bool:
        """
        Verify payment permit signature using EIP-712.

        Args:
            permit: Payment permit to verify
            signature: Signature string
            network: Network identifier

        Returns:
            True if signature is valid
        """
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            permit_address = NetworkConfig.get_payment_permit_address(network)
            chain_id = NetworkConfig.get_chain_id(network)

            self._logger.info("[SERVER VERIFY] Starting signature verification")
            self._logger.info(f"[SERVER VERIFY] Network: {network}, ChainId: {chain_id}")
            self._logger.info(f"[SERVER VERIFY] Permit address: {permit_address}")
            self._logger.info(f"[SERVER VERIFY] Buyer (original): {permit.buyer}")

            # Convert permit to EIP-712 message format
            message = self._convert_permit_to_message(permit)

            self._logger.info(f"[SERVER VERIFY] Buyer (converted): {message.get('buyer', 'N/A')}")
            self._logger.info(
                f"[SERVER VERIFY] PaymentId: {message.get('meta', {}).get('paymentId', 'N/A')}"
            )

            # Build EIP-712 typed data
            full_types = get_payment_permit_eip712_types()

            verifying_contract = self._get_verifying_contract(permit_address)
            domain = {
                "name": "PaymentPermit",
                "chainId": chain_id,
                "verifyingContract": verifying_contract,
            }

            self._logger.info(f"[SERVER VERIFY] Verifying contract: {verifying_contract}")

            typed_data = {
                "types": full_types,
                "primaryType": PAYMENT_PERMIT_PRIMARY_TYPE,
                "domain": domain,
                "message": message,
            }

            # Encode and verify signature
            signable = encode_typed_data(full_message=typed_data)
            sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
            recovered = Account.recover_message(signable, signature=sig_bytes)

            # Get expected signer address
            expected_address = self._get_expected_signer(permit.buyer)

            self._logger.info(
                f"[SERVER VERIFY] Expected signer: {expected_address}, "
                f"Recovered: {recovered}, Match: {recovered.lower() == expected_address.lower()}"
            )

            return recovered.lower() == expected_address.lower()
        except Exception as e:
            self._logger.error(f"[SERVER VERIFY] Signature verification failed: {e}", exc_info=True)
            return False

    def _convert_permit_to_message(self, permit: Any) -> dict[str, Any]:
        """
        Convert permit to EIP-712 message format.
        Subclasses can override for chain-specific handling.
        """

        message = permit.model_dump(by_alias=True)

        # Convert kind string to numeric value
        message["meta"]["kind"] = KIND_MAP.get(message["meta"]["kind"], 0)

        # Convert string values to integers
        message["meta"]["nonce"] = int(message["meta"]["nonce"])
        message["payment"]["payAmount"] = int(message["payment"]["payAmount"])
        message["fee"]["feeAmount"] = int(message["fee"]["feeAmount"])

        # Convert paymentId to bytes for eth_account
        payment_id = message["meta"]["paymentId"]
        if isinstance(payment_id, str) and payment_id.startswith("0x"):
            message["meta"]["paymentId"] = bytes.fromhex(payment_id[2:])

        return message

    @abstractmethod
    def _get_verifying_contract(self, permit_address: str) -> str:
        """
        Get verifying contract address in the format expected by the chain.
        Subclasses must implement for chain-specific address format.
        """
        pass

    @abstractmethod
    def _get_expected_signer(self, buyer_address: str) -> str:
        """
        Get expected signer address in the format for comparison.
        Subclasses must implement for chain-specific address format.
        """
        pass
