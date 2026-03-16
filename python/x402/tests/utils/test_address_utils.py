import types

from bankofai.x402.utils.address import checksum_evm_address


def test_checksum_evm_address_uses_web3(monkeypatch: object) -> None:
    class DummyWeb3:
        @staticmethod
        def to_checksum_address(addr: str) -> str:
            return "0xAbCdEf0000000000000000000000000000000000"

    monkeypatch.setitem(
        __import__("sys").modules,
        "web3",
        types.SimpleNamespace(Web3=DummyWeb3),
    )

    lower = "0xabcdef0000000000000000000000000000000000"
    assert checksum_evm_address(lower) == "0xAbCdEf0000000000000000000000000000000000"


def test_checksum_evm_address_invalid_returns_original() -> None:
    original = "not-an-address"
    assert checksum_evm_address(original) == original
