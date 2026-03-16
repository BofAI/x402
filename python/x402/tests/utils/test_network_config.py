from web3 import Web3

from bankofai.x402.config import NetworkConfig


def test_payment_permit_address_is_checksum_for_evm() -> None:
    addr = NetworkConfig.get_payment_permit_address("eip155:97")
    assert addr == Web3.to_checksum_address(addr)
