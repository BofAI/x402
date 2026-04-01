"""Tests for ERC-20 approval gas sponsoring extension."""

from bankofai.x402.extensions.erc20_approval_gas_sponsoring import (
    ERC20_APPROVAL_GAS_SPONSORING,
    declare_erc20_approval_gas_sponsoring_extension,
    extract_erc20_approval_gas_sponsoring_info,
    validate_erc20_approval_gas_sponsoring_info,
)


def test_declare_extension():
    ext = declare_erc20_approval_gas_sponsoring_extension()
    assert ERC20_APPROVAL_GAS_SPONSORING.key in ext


def test_extract_and_validate_info():
    payload_ext = {
        ERC20_APPROVAL_GAS_SPONSORING.key: {
            "info": {
                "from": "0x123",
                "asset": "0xabc",
                "spender": "0xdef",
                "amount": "100",
                "signedTransaction": "0x" + "11" * 10,
                "version": "1",
            },
            "schema": {},
        }
    }
    info = extract_erc20_approval_gas_sponsoring_info(payload_ext)
    assert info is not None
    assert validate_erc20_approval_gas_sponsoring_info(info) is True
