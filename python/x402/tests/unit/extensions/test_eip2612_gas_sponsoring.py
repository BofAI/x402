"""Tests for EIP-2612 gas sponsoring extension."""

from bankofai.x402.extensions.eip2612_gas_sponsoring import (
    EIP2612_GAS_SPONSORING,
    declare_eip2612_gas_sponsoring_extension,
    extract_eip2612_gas_sponsoring_info,
    validate_eip2612_gas_sponsoring_info,
)


def test_declare_extension():
    ext = declare_eip2612_gas_sponsoring_extension()
    assert EIP2612_GAS_SPONSORING.key in ext


def test_extract_and_validate_info():
    payload_ext = {
        EIP2612_GAS_SPONSORING.key: {
            "info": {
                "from": "0x123",
                "asset": "0xabc",
                "spender": "0xdef",
                "amount": "100",
                "nonce": "1",
                "deadline": "999999",
                "signature": "0x" + "11" * 65,
                "version": "1",
            },
            "schema": {},
        }
    }
    info = extract_eip2612_gas_sponsoring_info(payload_ext)
    assert info is not None
    assert validate_eip2612_gas_sponsoring_info(info) is True
