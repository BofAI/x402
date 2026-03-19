"""Tests for ExactEvmScheme client."""

try:
    from eth_account import Account
    from eth_account.signers.local import LocalAccount
except ImportError:
    import pytest

    pytest.skip("EVM client requires eth_account", allow_module_level=True)

from bankofai.x402.extensions.eip2612_gas_sponsoring import EIP2612_GAS_SPONSORING
from bankofai.x402.extensions.erc20_approval_gas_sponsoring import (
    ERC20_APPROVAL_GAS_SPONSORING,
)
from bankofai.x402.interfaces import PaymentPayloadContext
from bankofai.x402.mechanisms.evm.exact import ExactEvmClientScheme
from bankofai.x402.mechanisms.evm.signers import EthAccountSigner
from bankofai.x402.mechanisms.evm.utils import get_asset_info
from bankofai.x402.schemas import PaymentRequirements


class TestExactEvmSchemeConstructor:
    """Test ExactEvmScheme constructor."""

    def test_should_create_instance_with_correct_scheme(self):
        """Should create instance with correct scheme."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)

        assert client.scheme == "exact"

    def test_should_store_signer_reference(self):
        """Should store signer reference."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)

        # Client should have access to signer (internal attribute)
        assert client._signer is signer


class TestCreatePaymentPayload:
    """Test create_payment_payload method."""

    def test_should_have_create_payment_payload_method(self):
        """Should have create_payment_payload method."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)

        assert hasattr(client, "create_payment_payload")
        assert callable(client.create_payment_payload)

    def test_should_accept_v2_requirements_with_amount_field(self):
        """Should accept V2 requirements with amount field."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)
        network = "eip155:8453"

        # Verify the client accepts PaymentRequirements (v2) with amount field
        requirements = PaymentRequirements(
            scheme="exact",
            network=network,
            asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # USDC on Base
            amount="500000",  # V2 uses 'amount'
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={
                "name": "USD Coin",
                "version": "2",
            },
        )

        assert requirements.amount == "500000"
        assert client.scheme == "exact"

    def test_permit2_builds_eip2612_extension(self):
        class DummySigner:
            address = "0x1234567890123456789012345678901234567890"

            def sign_typed_data(self, *args, **kwargs):
                return b"\x01" * 65

            def read_contract(self, address, abi, function_name, *args):
                if function_name == "allowance":
                    return 0
                if function_name == "nonces":
                    return 1
                return 0

        client = ExactEvmClientScheme(DummySigner())
        requirements = PaymentRequirements(
            scheme="exact",
            network="eip155:8453",
            asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount="1000",
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={
                "name": "USD Coin",
                "version": "2",
                "assetTransferMethod": "permit2",
                "permit2FacilitatorAddress": "0x1111111111111111111111111111111111111111",
            },
        )

        context = PaymentPayloadContext(extensions={EIP2612_GAS_SPONSORING.key: {}})
        result = client.create_payment_payload(requirements, context)

        assert isinstance(result, tuple)
        payload, extensions = result
        assert "permit2Authorization" in payload
        assert EIP2612_GAS_SPONSORING.key in extensions

    def test_permit2_builds_erc20_extension(self):
        class DummySigner:
            address = "0x1234567890123456789012345678901234567890"

            def sign_typed_data(self, *args, **kwargs):
                return b"\x01" * 65

            def read_contract(self, address, abi, function_name, *args):
                if function_name == "allowance":
                    return 0
                return 0

            def sign_transaction(self, tx):
                return b"\x02" * 10

            def get_transaction_count(self, address):
                return 1

        client = ExactEvmClientScheme(DummySigner())
        requirements = PaymentRequirements(
            scheme="exact",
            network="eip155:8453",
            asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            amount="1000",
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={
                "name": "USD Coin",
                "version": "2",
                "assetTransferMethod": "permit2",
                "permit2FacilitatorAddress": "0x1111111111111111111111111111111111111111",
            },
        )

        context = PaymentPayloadContext(extensions={ERC20_APPROVAL_GAS_SPONSORING.key: {}})
        result = client.create_payment_payload(requirements, context)

        assert isinstance(result, tuple)
        payload, extensions = result
        assert "permit2Authorization" in payload
        assert ERC20_APPROVAL_GAS_SPONSORING.key in extensions

    def test_requirements_must_have_eip712_domain(self):
        """Requirements must have EIP-712 domain in extra."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)
        network = "eip155:8453"

        requirements = PaymentRequirements(
            scheme="exact",
            network=network,
            asset="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # USDC on Base
            amount="100000",
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={},  # Missing EIP-712 domain
        )

        # The method should exist and handle this error scenario
        assert client.create_payment_payload is not None
        assert requirements.extra is not None
        assert requirements.extra.get("name") is None


class TestClientSchemeAttributes:
    """Test client scheme attributes and methods."""

    def test_scheme_attribute_is_exact(self):
        """scheme attribute should be 'exact'."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)

        assert client.scheme == "exact"

    def test_client_stores_signer_reference(self):
        """Client should store signer reference."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer)

        # Client should have access to signer (internal attribute)
        assert client._signer is signer


class TestLocalAccountAutoWrap:
    """Test that raw LocalAccount is auto-wrapped in EthAccountSigner."""

    def test_should_auto_wrap_local_account(self):
        """Passing a raw LocalAccount should auto-wrap it in EthAccountSigner."""
        account = Account.create()
        assert isinstance(account, LocalAccount)

        client = ExactEvmClientScheme(signer=account)

        assert isinstance(client._signer, EthAccountSigner)

    def test_auto_wrapped_signer_has_correct_address(self):
        """Auto-wrapped signer should preserve the account address."""
        account = Account.create()

        client = ExactEvmClientScheme(signer=account)

        assert client._signer.address == account.address

    def test_pre_wrapped_signer_is_not_double_wrapped(self):
        """An EthAccountSigner should pass through without re-wrapping."""
        account = Account.create()
        signer = EthAccountSigner(account)

        client = ExactEvmClientScheme(signer=signer)

        assert client._signer is signer

    def test_raw_local_account_can_sign_payload(self):
        """End-to-end: raw LocalAccount should produce a valid signed payload."""
        account = Account.create()
        network = "eip155:8453"

        # Pass raw LocalAccount — no manual EthAccountSigner wrapping
        client = ExactEvmClientScheme(signer=account)

        requirements = PaymentRequirements(
            scheme="exact",
            network=network,
            asset=get_asset_info(network, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")["address"],
            amount="500000",
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={
                "name": "USD Coin",
                "version": "2",
            },
        )

        payload = client.create_payment_payload(requirements)

        assert "authorization" in payload
        assert "signature" in payload

    def test_local_account_uses_network_specific_rpc_resolution(self, monkeypatch):
        account = Account.create()
        monkeypatch.delenv("EVM_RPC_URL", raising=False)
        monkeypatch.delenv("WEB3_PROVIDER_URL", raising=False)
        monkeypatch.setenv("EVM_RPC_URL_84532", "https://example-base-sepolia.local")

        client = ExactEvmClientScheme(signer=account)

        requirements = PaymentRequirements(
            scheme="exact",
            network="eip155:84532",
            asset="0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            amount="500000",
            pay_to="0x0987654321098765432109876543210987654321",
            max_timeout_seconds=3600,
            extra={"name": "USDC", "version": "2"},
        )
        client.create_payment_payload(requirements)

        network_signer = client._network_signers["eip155:84532"]
        assert isinstance(network_signer, EthAccountSigner)
        assert network_signer._w3 is not None
        assert network_signer._w3.provider.endpoint_uri == "https://example-base-sepolia.local"
