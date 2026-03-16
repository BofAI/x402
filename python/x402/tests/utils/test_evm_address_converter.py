from bankofai.x402.address.converter import EvmAddressConverter


def test_evm_address_converter_normalizes_to_checksum() -> None:
    from web3 import Web3

    converter = EvmAddressConverter()
    lower = "0x52908400098527886e0f7030069857d2e4169ee7"
    assert converter.normalize(lower) == Web3.to_checksum_address(lower)


def test_evm_address_converter_checksums_message() -> None:
    from web3 import Web3

    converter = EvmAddressConverter()
    message = {
        "buyer": "0x52908400098527886e0f7030069857d2e4169ee7",
        "caller": "0xde709f2102306220921060314715629080e2fb77",
        "payment": {
            "payToken": "0x27b1fdb04752bbc536007a920d24acb045561c26",
            "payTo": "0x5aeda56215b167893e80b4fe645ba6d5bab767de",
        },
        "fee": {"feeTo": "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359"},
    }

    converted = converter.convert_message_addresses(message)
    assert converted["buyer"] == Web3.to_checksum_address(message["buyer"])
    assert converted["caller"] == Web3.to_checksum_address(message["caller"])
    assert converted["payment"]["payToken"] == Web3.to_checksum_address(message["payment"]["payToken"])
    assert converted["payment"]["payTo"] == Web3.to_checksum_address(message["payment"]["payTo"])
    assert converted["fee"]["feeTo"] == Web3.to_checksum_address(message["fee"]["feeTo"])
