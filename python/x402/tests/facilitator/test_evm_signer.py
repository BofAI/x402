from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bankofai.x402.signers.facilitator import EvmFacilitatorSigner


@pytest.mark.anyio
async def test_evm_facilitator_signer_creation(mock_evm_private_key):
    """Test EVM facilitator signer creation"""
    from eth_account import Account

    address = Account.from_key(mock_evm_private_key).address
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value=address)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmFacilitatorSigner.create()
    assert signer is not None
    address = await signer.get_address()
    assert address.lower() == "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c".lower()


@pytest.mark.anyio
async def test_evm_verify_typed_data(mock_evm_private_key):
    """Test EVM signature verification"""
    from eth_account import Account

    domain = {
        "name": "PaymentPermit",
        "chainId": 1,
        "verifyingContract": "0x0000000000000000000000000000000000000000",
    }
    types = {"Test": [{"name": "content", "type": "string"}]}
    message = {"content": "test"}

    from eth_account.messages import encode_typed_data

    from bankofai.x402.abi import PAYMENT_PERMIT_EIP712_DOMAIN_TYPE

    address = Account.from_key(mock_evm_private_key).address
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value=address)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmFacilitatorSigner.create()

    full_types = {"EIP712Domain": PAYMENT_PERMIT_EIP712_DOMAIN_TYPE, **types}

    typed_data = {"types": full_types, "primaryType": "Test", "domain": domain, "message": message}

    encoded = encode_typed_data(full_message=typed_data)
    signed = Account.sign_message(encoded, private_key=mock_evm_private_key)
    signature = signed.signature.hex()

    # Verify
    address = await signer.get_address()
    valid = await signer.verify_typed_data(
        address, domain, types, message, signature, primary_type="Test"
    )
    assert valid is True


@pytest.mark.anyio
async def test_evm_verify_typed_data_invalid(mock_evm_private_key):
    """Test invalid signature verification"""
    from eth_account import Account

    address = Account.from_key(mock_evm_private_key).address
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value=address)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmFacilitatorSigner.create()

    domain = {"name": "Test", "chainId": 1, "verifyingContract": "0x00"}
    types = {"Test": [{"name": "content", "type": "string"}]}
    message = {"content": "test"}
    signature = "0x" + "00" * 65

    address = await signer.get_address()
    valid = await signer.verify_typed_data(
        address, domain, types, message, signature, primary_type="Test"
    )
    assert valid is False
