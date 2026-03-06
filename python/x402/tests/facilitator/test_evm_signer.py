import pytest

from bankofai.x402.signers.facilitator import EvmFacilitatorSigner


def test_evm_facilitator_signer_creation(mock_evm_private_key):
    """Test EVM facilitator signer creation"""
    signer = EvmFacilitatorSigner.from_private_key(mock_evm_private_key)
    assert signer is not None
    assert signer.get_address().lower() == "0xFCAd0B19bB29D4674531d6f115237E16AfCE377c".lower()


@pytest.mark.anyio
async def test_evm_verify_typed_data(mock_evm_private_key):
    """Test EVM signature verification"""
    signer = EvmFacilitatorSigner.from_private_key(mock_evm_private_key)

    # Mock data
    domain = {
        "name": "PaymentPermit",
        "chainId": 1,
        "verifyingContract": "0x0000000000000000000000000000000000000000",
    }
    types = {"Test": [{"name": "content", "type": "string"}]}
    message = {"content": "test"}

    # Sign using eth_account (mock client behavior)
    from eth_account import Account
    from eth_account.messages import encode_typed_data

    from bankofai.x402.abi import PAYMENT_PERMIT_EIP712_DOMAIN_TYPE

    full_types = {"EIP712Domain": PAYMENT_PERMIT_EIP712_DOMAIN_TYPE, **types}

    typed_data = {"types": full_types, "primaryType": "Test", "domain": domain, "message": message}

    encoded = encode_typed_data(full_message=typed_data)
    signed = Account.sign_message(encoded, private_key=mock_evm_private_key)
    signature = signed.signature.hex()

    # Verify
    valid = await signer.verify_typed_data(
        signer.get_address(), domain, types, message, signature, primary_type="Test"
    )
    assert valid is True


@pytest.mark.anyio
async def test_evm_verify_typed_data_invalid(mock_evm_private_key):
    """Test invalid signature verification"""
    signer = EvmFacilitatorSigner.from_private_key(mock_evm_private_key)

    domain = {"name": "Test", "chainId": 1, "verifyingContract": "0x00"}
    types = {"Test": [{"name": "content", "type": "string"}]}
    message = {"content": "test"}
    signature = "0x" + "00" * 65

    valid = await signer.verify_typed_data(
        signer.get_address(), domain, types, message, signature, primary_type="Test"
    )
    assert valid is False
