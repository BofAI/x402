"""
ExactPermitEvmClientMechanism - "exact_permit" payment scheme EVM client mechanism
"""

from bankofai.x402.address import AddressConverter, EvmAddressConverter
from bankofai.x402.mechanisms._exact_permit_base.client import BaseExactPermitClientMechanism


class ExactPermitEvmClientMechanism(BaseExactPermitClientMechanism):
    def _get_address_converter(self) -> AddressConverter:
        return EvmAddressConverter()
