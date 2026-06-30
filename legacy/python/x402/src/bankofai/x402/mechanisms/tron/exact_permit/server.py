"""
ExactPermitTronServerMechanism - "exact_permit" 支付方案的 TRON 服务器机制
"""

from typing import Any

from bankofai.x402.mechanisms._exact_permit_base.server import BaseExactPermitServerMechanism
from bankofai.x402.types import KIND_MAP


class ExactPermitTronServerMechanism(BaseExactPermitServerMechanism):
    def _get_network_prefix(self) -> str:
        return "tron:"

    def _validate_address_format(self, address: str) -> bool:
        """Validate TRON address format (starts with T)"""
        return address.startswith("T")

    def _get_verifying_contract(self, permit_address: str) -> str:
        """Convert TRON address to EVM format for EIP-712 verification"""
        from bankofai.x402.utils.address import tron_address_to_evm

        return tron_address_to_evm(permit_address)

    def _get_expected_signer(self, buyer_address: str) -> str:
        """Convert TRON buyer address to EVM format for comparison"""
        from bankofai.x402.utils.address import tron_address_to_evm

        return tron_address_to_evm(buyer_address)

    def _convert_permit_to_message(self, permit: Any) -> dict[str, Any]:
        """
        Convert permit to EIP-712 message format with TRON addresses converted to EVM format.
        """
        from bankofai.x402.utils.address import tron_address_to_evm

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

        # Convert all TRON addresses to EVM format for EIP-712 encoding
        message["buyer"] = tron_address_to_evm(message["buyer"])
        message["caller"] = tron_address_to_evm(message["caller"])
        message["payment"]["payToken"] = tron_address_to_evm(message["payment"]["payToken"])
        message["payment"]["payTo"] = tron_address_to_evm(message["payment"]["payTo"])
        message["fee"]["feeTo"] = tron_address_to_evm(message["fee"]["feeTo"])

        return message
