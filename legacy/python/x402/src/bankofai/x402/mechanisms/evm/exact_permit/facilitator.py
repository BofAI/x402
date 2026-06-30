"""
ExactPermitEvmFacilitatorMechanism - "exact_permit" payment scheme EVM facilitator mechanism
"""

from typing import Any

from bankofai.x402.abi import PAYMENT_PERMIT_ABI, get_abi_json
from bankofai.x402.address import AddressConverter, EvmAddressConverter
from bankofai.x402.config import NetworkConfig
from bankofai.x402.mechanisms._exact_permit_base.facilitator import (
    BaseExactPermitFacilitatorMechanism,
)
from bankofai.x402.types import PaymentRequirements


class ExactPermitEvmFacilitatorMechanism(BaseExactPermitFacilitatorMechanism):
    """exact_permit payment scheme facilitator mechanism for EVM"""

    def _get_address_converter(self) -> AddressConverter:
        return EvmAddressConverter()

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
