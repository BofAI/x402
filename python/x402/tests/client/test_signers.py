from unittest.mock import AsyncMock, MagicMock

import pytest

from bankofai.x402.signers.client import EvmClientSigner, TronClientSigner


def test_tron_signer_from_private_key():
    """Test creating TRON signer from private key"""
    private_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = TronClientSigner.from_private_key(private_key)

    assert signer is not None
    assert signer.get_address().startswith("T")


def test_tron_signer_with_0x_prefix():
    """Test TRON signer handling 0x prefix"""
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = TronClientSigner.from_private_key(private_key)

    assert signer is not None
    assert signer.get_address().startswith("T")


def test_evm_signer_from_private_key():
    """Test creating EVM signer from private key"""
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

    assert signer is not None
    assert signer.get_address().startswith("0x")
    assert len(signer.get_address()) == 42


def test_evm_signer_without_0x_prefix():
    """Test EVM signer adding 0x prefix when missing"""
    private_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

    assert signer is not None
    assert signer.get_address().startswith("0x")


@pytest.mark.anyio
async def test_tron_signer_check_allowance():
    """Test TRON signer allowance check (without tronpy)"""
    private_key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = TronClientSigner.from_private_key(private_key)

    # Should return 0 when no tronpy client available
    allowance = await signer.check_allowance("TTestToken", 1000000, "tron:shasta")
    assert allowance == 0


@pytest.mark.anyio
async def test_evm_signer_check_allowance():
    """Test EVM signer allowance check propagates contract failures"""
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

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
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

    message = b"hello world"
    signature = await signer.sign_message(message)

    assert signature is not None
    assert signature.startswith("0x") or len(signature) == 130


@pytest.mark.anyio
async def test_evm_signer_sign_typed_data():
    """Test EVM signer typed data signing"""
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

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


@pytest.mark.anyio
async def test_evm_signer_check_balance():
    """Test EVM signer balance check propagates contract failures"""
    private_key = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    signer = EvmClientSigner.from_private_key(private_key)

    contract = MagicMock()
    contract.functions.balanceOf.return_value.call = AsyncMock(side_effect=RuntimeError("boom"))
    mock_w3 = MagicMock()
    mock_w3.eth.contract.return_value = contract
    signer._ensure_async_web3_client = MagicMock(return_value=mock_w3)

    with pytest.raises(RuntimeError, match="boom"):
        await signer.check_balance("0x0000000000000000000000000000000000000002", "eip155:1")
