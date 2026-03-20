import types

from web3 import Web3

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


def test_checksum_evm_address_invalid_strict_raises() -> None:
    original = "0x1234"
    try:
        checksum_evm_address(original, strict=True)
    except ValueError as exc:
        assert "Invalid EVM address" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid EVM address")


def test_checksum_evm_address_already_checksum() -> None:
    addr = "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816"
    assert checksum_evm_address(addr) == addr


def test_checksum_evm_address_non_checksum_with_0x() -> None:
    addr = "0x375caDdd2cB68cE82e3D9B075D551067a7b4B816"
    assert checksum_evm_address(addr) == Web3.to_checksum_address(addr)


def test_checksum_evm_address_no_0x_prefix() -> None:
    raw = "375caDdd2cB68cE82e3D9B075D551067a7b4B816"
    assert checksum_evm_address(raw) == Web3.to_checksum_address("0x" + raw)
