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
    address = signer.get_address()
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
    address = signer.get_address()
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

    address = signer.get_address()
    valid = await signer.verify_typed_data(
        address, domain, types, message, signature, primary_type="Test"
    )
    assert valid is False


@pytest.mark.anyio
async def test_evm_check_balance_raises_on_contract_error(mock_evm_private_key):
    from eth_account import Account

    address = Account.from_key(mock_evm_private_key).address
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value=address)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmFacilitatorSigner.create()

    contract = MagicMock()
    contract.functions.balanceOf.return_value.call = AsyncMock(side_effect=RuntimeError("boom"))
    mock_w3 = MagicMock()
    mock_w3.eth.contract.return_value = contract
    signer._ensure_async_web3_client = MagicMock(return_value=mock_w3)

    with pytest.raises(RuntimeError, match="boom"):
        await signer.check_balance("0x0000000000000000000000000000000000000002", "eip155:1")


@pytest.mark.anyio
async def test_evm_write_contract_raises_on_contract_error(mock_evm_private_key):
    from eth_account import Account
    import asyncio

    address = Account.from_key(mock_evm_private_key).address
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value=address)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmFacilitatorSigner.create()

    broken_call = MagicMock()
    broken_call.build_transaction = AsyncMock(side_effect=RuntimeError("boom"))
    contract = MagicMock()
    contract.functions.transfer = MagicMock(return_value=broken_call)
    mock_w3 = MagicMock()
    mock_w3.eth.contract.return_value = contract
    mock_w3.eth.get_transaction_count = AsyncMock(return_value=1)
    chain_id = asyncio.Future()
    chain_id.set_result(1)
    mock_w3.eth.chain_id = chain_id
    signer._ensure_async_web3_client = MagicMock(return_value=mock_w3)

    with pytest.raises(RuntimeError, match="boom"):
        await signer.write_contract(
            contract_address="0x0000000000000000000000000000000000000001",
            abi=[],
            method="transfer",
            args=["0x0000000000000000000000000000000000000002", 1],
            network="eip155:1",
        )
