"""
ExactPermitTronClientMechanism - "exact_permit" 支付方案的 TRON 客户端机制
"""

from bankofai.x402.address import AddressConverter, TronAddressConverter
from bankofai.x402.mechanisms._exact_permit_base.client import BaseExactPermitClientMechanism


class ExactPermitTronClientMechanism(BaseExactPermitClientMechanism):
    def _get_address_converter(self) -> AddressConverter:
        return TronAddressConverter()
