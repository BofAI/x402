"""
Address converter interface and implementations
"""

from abc import ABC, abstractmethod
from typing import Any

from bankofai.x402.utils.address import (
    checksum_evm_address,
    normalize_tron_address,
    tron_address_to_evm,
)


class AddressConverter(ABC):
    """Abstract base class for address converters"""

    @abstractmethod
    def normalize(self, address: str) -> str:
        """Normalize address format"""
        pass

    @abstractmethod
    def to_evm_format(self, address: str) -> str:
        """Convert to EVM format (0x...)"""
        pass

    @abstractmethod
    def get_zero_address(self) -> str:
        """Get zero address"""
        pass

    def convert_message_addresses(self, message: dict[str, Any]) -> dict[str, Any]:
        """Convert all addresses in message to EVM format (for EIP-712 signing)"""
        message["buyer"] = self.to_evm_format(message["buyer"])
        message["caller"] = self.to_evm_format(message["caller"])
        message["payment"]["payToken"] = self.to_evm_format(message["payment"]["payToken"])
        message["payment"]["payTo"] = self.to_evm_format(message["payment"]["payTo"])
        message["fee"]["feeTo"] = self.to_evm_format(message["fee"]["feeTo"])
        return message


class EvmAddressConverter(AddressConverter):
    """EVM address converter"""

    ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

    def normalize(self, address: str) -> str:
        """EVM addresses do not need normalization"""
        return checksum_evm_address(address)

    def to_evm_format(self, address: str) -> str:
        """Already in EVM format"""
        return checksum_evm_address(address)

    def get_zero_address(self) -> str:
        return self.ZERO_ADDRESS

    def convert_message_addresses(self, message: dict[str, Any]) -> dict[str, Any]:
        """Normalize EVM addresses to checksum format"""
        message["buyer"] = checksum_evm_address(message["buyer"])
        message["caller"] = checksum_evm_address(message["caller"])
        message["payment"]["payToken"] = checksum_evm_address(message["payment"]["payToken"])
        message["payment"]["payTo"] = checksum_evm_address(message["payment"]["payTo"])
        message["fee"]["feeTo"] = checksum_evm_address(message["fee"]["feeTo"])
        return message


class TronAddressConverter(AddressConverter):
    """TRON address converter"""

    ZERO_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"

    def normalize(self, address: str) -> str:
        """Normalize TRON address"""
        return normalize_tron_address(address)

    def to_evm_format(self, address: str) -> str:
        """Convert TRON address to EVM format"""
        return tron_address_to_evm(address)

    def get_zero_address(self) -> str:
        return self.ZERO_ADDRESS
