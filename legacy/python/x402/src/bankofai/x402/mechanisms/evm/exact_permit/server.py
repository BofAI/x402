"""
ExactPermitEvmServerMechanism - "exact_permit" payment scheme EVM server mechanism
"""

from bankofai.x402.mechanisms._exact_permit_base.server import BaseExactPermitServerMechanism


class ExactPermitEvmServerMechanism(BaseExactPermitServerMechanism):
    def _get_network_prefix(self) -> str:
        return "eip155:"

    def _validate_address_format(self, address: str) -> bool:
        """Validate EVM address format (starts with 0x)"""
        return address.startswith("0x")

    def _get_verifying_contract(self, permit_address: str) -> str:
        """EVM address is already in the correct format"""
        return permit_address

    def _get_expected_signer(self, buyer_address: str) -> str:
        """EVM address is already in the correct format"""
        return buyer_address
