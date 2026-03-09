from typing import Any

from bankofai.x402_deprecated.abi import (
    PAYMENT_PERMIT_ABI,
    PAYMENT_PERMIT_PRIMARY_TYPE,
    get_abi_json,
    get_payment_permit_eip712_types,
)
from bankofai.x402_deprecated.address import AddressConverter, TronAddressConverter
from bankofai.x402_deprecated.config import NetworkConfig
from bankofai.x402_deprecated.mechanisms._exact_permit_base.facilitator import (
    BaseExactPermitFacilitatorMechanism,
)
from bankofai.x402_deprecated.types import KIND_MAP, PaymentPermit, PaymentRequirements


class ExactPermitTronFacilitatorMechanism(BaseExactPermitFacilitatorMechanism):
    """exact_permit 支付方案的 TRON facilitator 机制"""

    def _get_address_converter(self) -> AddressConverter:
        return TronAddressConverter()

    async def _verify_signature(
        self,
        permit: PaymentPermit,
        signature: str,
        network: str,
    ) -> bool:
        """Verify EIP-712 signature with TronWeb format (hex string for paymentId)"""
        permit_address = NetworkConfig.get_payment_permit_address(network)
        chain_id = NetworkConfig.get_chain_id(network)
        converter = self._address_converter

        # Convert permit to EIP-712 message format WITHOUT converting paymentId to bytes
        # TronWeb signs with hex strings for bytes16 fields
        message = permit.model_dump(by_alias=True)

        # Convert kind string to numeric value
        message["meta"]["kind"] = KIND_MAP.get(message["meta"]["kind"], 0)

        # Convert string values to integers for EIP-712 compatibility
        message["meta"]["nonce"] = int(message["meta"]["nonce"])
        message["payment"]["payAmount"] = int(message["payment"]["payAmount"])
        message["fee"]["feeAmount"] = int(message["fee"]["feeAmount"])

        # Keep paymentId as hex string (TronWeb format) - do NOT convert to bytes
        # message["meta"]["paymentId"] remains as "0x..." string

        # Convert addresses to EVM format
        message = converter.convert_message_addresses(message)

        # Debug logging
        import logging

        logger = logging.getLogger(__name__)
        logger.info(
            "[VERIFY TRON] Domain: name=PaymentPermit, chainId=%s, verifyingContract=%s",
            chain_id,
            converter.to_evm_format(permit_address),
        )
        logger.info(f"[VERIFY TRON] Message: {message}")
        logger.info(f"[VERIFY TRON] Signature: {signature}")
        logger.info(f"[VERIFY TRON] Buyer address: {permit.buyer}")

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

    async def _settle_payment_only(
        self,
        permit: Any,
        signature: str,
        requirements: PaymentRequirements,
    ) -> str | None:
        """Payment only settlement (no on-chain delivery)"""
        contract_address = NetworkConfig.get_payment_permit_address(requirements.network)
        self._logger.info(f"Calling permitTransferFrom on contract={contract_address}")

        permit_tuple = self._build_permit_tuple(permit)
        sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
        buyer = self._address_converter.normalize(permit.buyer)

        args = [permit_tuple, buyer, sig_bytes]
        self._logger.info(
            f"Calling permitTransferFrom with {len(args)} arguments (PAYMENT_ONLY mode)"
        )

        return await self._signer.write_contract(
            contract_address=contract_address,
            abi=get_abi_json(PAYMENT_PERMIT_ABI),
            method="permitTransferFrom",
            args=args,
            network=requirements.network,
        )
