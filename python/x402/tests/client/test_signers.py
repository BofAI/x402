from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from bankofai.x402.signers.client import EvmClientSigner, TronClientSigner


@pytest.mark.anyio
async def test_tron_signer_create():
    """Test creating TRON signer from wallet"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="TTestBuyerAddress")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await TronClientSigner.create()

    assert signer is not None
    address = signer.get_address()
    assert address.startswith("T")


@pytest.mark.anyio
async def test_tron_signer_uses_wallet_address():
    """Test TRON signer uses resolved wallet address"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="TAnotherBuyerAddress")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await TronClientSigner.create()

    assert signer is not None
    assert signer.get_address() == "TAnotherBuyerAddress"


@pytest.mark.anyio
async def test_evm_signer_create():
    """Test creating EVM signer from wallet"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0xFCAd0B19bB29D4674531d6f115237E16AfCE377c")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    assert signer is not None
    address = signer.get_address()
    assert address.startswith("0x")
    assert len(address) == 42


@pytest.mark.anyio
async def test_evm_signer_uses_wallet_address():
    """Test EVM signer uses resolved wallet address"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0x1111111111111111111111111111111111111111")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    assert signer is not None
    assert signer.get_address() == "0x1111111111111111111111111111111111111111"


@pytest.mark.anyio
async def test_tron_signer_check_allowance():
    """Test TRON signer allowance check (without tronpy)"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="TTestBuyerAddress")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await TronClientSigner.create()

    # Should return 0 when no tronpy client available
    allowance = await signer.check_allowance("TTestToken", 1000000, "tron:shasta")
    assert allowance == 0


@pytest.mark.anyio
async def test_tron_signer_ensure_allowance_builds_agent_wallet_payload():
    """Test TRON approval signs a payload containing raw_data_hex."""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="TTestBuyerAddress")
    wallet.sign_transaction = AsyncMock(return_value='{"signature":["' + ("ab" * 65) + '"]}')

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await TronClientSigner.create()

    signer.check_allowance = AsyncMock(return_value=0)
    signer._get_spender_address = MagicMock(return_value="TSpenderAddress")

    broadcast_result = MagicMock()
    broadcast_result.wait = AsyncMock(return_value={"receipt": {"result": "SUCCESS"}, "id": "txid"})

    txn = MagicMock()
    txn.to_json.return_value = {"txID": "txid", "raw_data": {"fee_limit": 100000000}}
    txn.raw_data_hex = "deadbeef"
    txn.broadcast = AsyncMock(return_value=broadcast_result)

    txn_builder = MagicMock()
    txn_builder.with_owner.return_value = txn_builder
    txn_builder.fee_limit.return_value = txn_builder
    txn_builder.build = AsyncMock(return_value=txn)

    contract = MagicMock()
    contract.functions.approve = AsyncMock(return_value=txn_builder)

    client = MagicMock()
    client.get_contract = AsyncMock(return_value=contract)
    signer._ensure_async_tron_client = MagicMock(return_value=client)

    assert await signer.ensure_allowance("TTestToken", 1000000, "tron:nile") is True
    wallet.sign_transaction.assert_awaited_once_with(
        {
            "txID": "txid",
            "raw_data_hex": "deadbeef",
            "raw_data": {"fee_limit": 100000000},
        }
    )


@pytest.mark.anyio
async def test_evm_signer_check_allowance():
    """Test EVM signer allowance check propagates contract failures"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0x1111111111111111111111111111111111111111")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    contract = MagicMock()
    contract.functions.allowance.return_value.call = AsyncMock(side_effect=RuntimeError("boom"))
    mock_w3 = MagicMock()
    mock_w3.eth.contract.return_value = contract
    signer._ensure_async_web3_client = MagicMock(return_value=mock_w3)
    signer._get_spender_address = MagicMock(
        return_value="0x0000000000000000000000000000000000000001"
    )

    with pytest.raises(RuntimeError, match="boom"):
        await signer.check_allowance(
            "0x0000000000000000000000000000000000000002", 1000000, "eip155:1"
        )


@pytest.mark.anyio
async def test_evm_signer_sign_message():
    """Test EVM signer message signing"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0x1111111111111111111111111111111111111111")
    wallet.sign_message = AsyncMock(return_value="0x" + "ab" * 65)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    message = b"hello world"
    signature = await signer.sign_message(message)

    assert signature is not None
    assert signature.startswith("0x") or len(signature) == 130
    wallet.sign_message.assert_awaited_once_with(message)


@pytest.mark.anyio
async def test_evm_signer_sign_typed_data():
    """Test EVM signer typed data signing"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0x1111111111111111111111111111111111111111")
    wallet.sign_typed_data = AsyncMock(return_value="0x" + "cd" * 65)

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    domain = {
        "name": "Test",
        "chainId": 1,
        "verifyingContract": "0x0000000000000000000000000000000000000000",
    }
    types = {
        "Person": [
            {"name": "name", "type": "string"},
            {"name": "wallet", "type": "address"},
        ],
    }
    message = {
        "name": "Bob",
        "wallet": "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB",
    }

    signature = await signer.sign_typed_data(domain, types, message, primary_type="Person")

    assert signature is not None
    assert signature.startswith("0x") or len(signature) == 130
    wallet.sign_typed_data.assert_awaited_once_with(
        {
            "types": types,
            "domain": domain,
            "primaryType": "Person",
            "message": message,
        }
    )


@pytest.mark.anyio
async def test_evm_signer_check_balance():
    """Test EVM signer balance check propagates contract failures"""
    wallet = MagicMock()
    wallet.get_address = AsyncMock(return_value="0x1111111111111111111111111111111111111111")

    provider = MagicMock()
    provider.get_active_wallet = AsyncMock(return_value=wallet)

    with patch("agent_wallet.resolve_wallet_provider", return_value=provider):
        signer = await EvmClientSigner.create()

    contract = MagicMock()
    contract.functions.balanceOf.return_value.call = AsyncMock(side_effect=RuntimeError("boom"))
    mock_w3 = MagicMock()
    mock_w3.eth.contract.return_value = contract
    signer._ensure_async_web3_client = MagicMock(return_value=mock_w3)

    with pytest.raises(RuntimeError, match="boom"):
        await signer.check_balance("0x0000000000000000000000000000000000000002", "eip155:1")
