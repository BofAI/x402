"""Unit tests for x402Client and x402ClientSync - manual registration and policies."""

import pytest

from bankofai.x402 import (
    prefer_network,
    x402Client,
    x402ClientSync,
)
from bankofai.x402.schemas.v1 import (
    PaymentPayloadV1,
    PaymentRequiredV1,
    PaymentRequirementsV1,
)

# =============================================================================
# Mock Scheme Clients
# =============================================================================


class MockSchemeClient:
    """Mock V2 scheme client for testing."""

    scheme = "mock"

    def __init__(self, scheme: str = "mock"):
        self.scheme = scheme
        self.create_calls: list = []

    def create_payment_payload(self, requirements):
        self.create_calls.append(requirements)
        return {"mock": "payload", "network": requirements.network}


class MockSchemeClientV1:
    """Mock V1 scheme client for testing."""

    scheme = "mock-v1"

    def __init__(self, scheme: str = "mock-v1"):
        self.scheme = scheme

    def create_payment_payload(self, requirements):
        return {"mock": "v1-payload", "network": requirements.network}


# =============================================================================
# x402Client Registration Tests
# =============================================================================


class TestX402ClientRegistration:
    """Tests for x402Client scheme registration."""

    def test_register_v2_scheme(self):
        """Test registering a V2 scheme."""
        client = x402Client()
        mock_scheme = MockSchemeClient()

        result = client.register("eip155:8453", mock_scheme)

        # Should return self for chaining
        assert result is client

        registered = client.get_registered_schemes()
        assert len(registered[2]) == 1
        assert registered[2][0]["network"] == "eip155:8453"
        assert registered[2][0]["scheme"] == "mock"

    def test_register_v1_scheme(self):
        """Test registering a V1 scheme."""
        client = x402Client()
        mock_scheme = MockSchemeClientV1()

        client.register_v1("base-sepolia", mock_scheme)

        registered = client.get_registered_schemes()
        assert len(registered[1]) == 1
        assert registered[1][0]["network"] == "base-sepolia"

    def test_register_multiple_schemes(self):
        """Test registering multiple schemes."""
        client = x402Client()

        client.register("eip155:8453", MockSchemeClient())
        client.register("eip155:1", MockSchemeClient())
        client.register("solana:mainnet", MockSchemeClient("solana-exact"))

        registered = client.get_registered_schemes()
        assert len(registered[2]) == 3

    def test_chained_registration(self):
        """Test chaining registration calls."""
        client = (
            x402Client()
            .register("eip155:8453", MockSchemeClient())
            .register("eip155:1", MockSchemeClient())
        )

        registered = client.get_registered_schemes()
        assert len(registered[2]) == 2


class TestX402ClientSyncRegistration:
    """Tests for x402ClientSync scheme registration."""

    def test_register_v2_scheme(self):
        """Test registering a V2 scheme on sync client."""
        client = x402ClientSync()
        mock_scheme = MockSchemeClient()

        result = client.register("eip155:8453", mock_scheme)

        assert result is client
        registered = client.get_registered_schemes()
        assert len(registered[2]) == 1

    def test_register_v1_scheme(self):
        """Test registering a V1 scheme on sync client."""
        client = x402ClientSync()

        client.register_v1("base-sepolia", MockSchemeClientV1())

        registered = client.get_registered_schemes()
        assert len(registered[1]) == 1


# =============================================================================
# Policy Tests
# =============================================================================


class TestX402ClientPolicies:
    """Tests for x402Client policy registration and application."""

    def test_register_policy(self):
        """Test registering a policy."""
        client = x402Client()
        policy = prefer_network("eip155:8453")

        result = client.register_policy(policy)

        assert result is client
        assert len(client._policies) == 1

    def test_register_multiple_policies(self):
        """Test registering multiple policies."""
        client = x402Client()

        client.register_policy(prefer_network("eip155:8453"))
        client.register_policy(prefer_network("eip155:1"))

        assert len(client._policies) == 2

    def test_chained_policy_registration(self):
        """Test chaining policy registration."""
        client = (
            x402Client()
            .register("eip155:8453", MockSchemeClient())
            .register_policy(prefer_network("eip155:8453"))
            .register_policy(prefer_network("eip155:1"))
        )

        assert len(client._policies) == 2


class TestX402ClientSyncPolicies:
    """Tests for x402ClientSync policy registration."""

    def test_register_policy(self):
        """Test registering a policy on sync client."""
        client = x402ClientSync()
        policy = prefer_network("eip155:8453")

        client.register_policy(policy)

        assert len(client._policies) == 1


# =============================================================================
# Hook Registration Tests
# =============================================================================


class TestX402ClientHooks:
    """Tests for x402Client hook registration."""

    def test_register_before_payment_creation_hook(self):
        """Test registering before_payment_creation hook."""
        client = x402Client()

        def hook(ctx):
            return None

        result = client.on_before_payment_creation(hook)

        assert result is client
        assert len(client._before_payment_creation_hooks) == 1

    def test_register_after_payment_creation_hook(self):
        """Test registering after_payment_creation hook."""
        client = x402Client()

        def hook(ctx):
            pass

        client.on_after_payment_creation(hook)

        assert len(client._after_payment_creation_hooks) == 1

    def test_register_payment_creation_failure_hook(self):
        """Test registering payment_creation_failure hook."""
        client = x402Client()

        def hook(ctx):
            return None

        client.on_payment_creation_failure(hook)

        assert len(client._on_payment_creation_failure_hooks) == 1

    def test_chained_hook_registration(self):
        """Test chaining hook registration."""
        client = (
            x402Client()
            .on_before_payment_creation(lambda ctx: None)
            .on_after_payment_creation(lambda ctx: None)
            .on_payment_creation_failure(lambda ctx: None)
        )

        assert len(client._before_payment_creation_hooks) == 1
        assert len(client._after_payment_creation_hooks) == 1
        assert len(client._on_payment_creation_failure_hooks) == 1


class TestX402ClientSyncHooks:
    """Tests for x402ClientSync hook registration."""

    def test_register_before_payment_creation_hook(self):
        """Test registering before_payment_creation hook on sync client."""
        client = x402ClientSync()

        def hook(ctx):
            return None

        client.on_before_payment_creation(hook)

        assert len(client._before_payment_creation_hooks) == 1

    def test_register_all_hooks(self):
        """Test registering all hooks on sync client."""
        client = x402ClientSync()

        client.on_before_payment_creation(lambda ctx: None)
        client.on_after_payment_creation(lambda ctx: None)
        client.on_payment_creation_failure(lambda ctx: None)

        assert len(client._before_payment_creation_hooks) == 1
        assert len(client._after_payment_creation_hooks) == 1
        assert len(client._on_payment_creation_failure_hooks) == 1


# =============================================================================
# get_registered_schemes Tests
# =============================================================================


class TestGetRegisteredSchemes:
    """Tests for get_registered_schemes method."""

    def test_empty_client_returns_empty_dict(self):
        """Test that empty client returns empty version dicts."""
        client = x402Client()
        registered = client.get_registered_schemes()

        assert 1 in registered
        assert 2 in registered
        assert len(registered[1]) == 0
        assert len(registered[2]) == 0

    def test_returns_scheme_info(self):
        """Test that registered schemes include scheme and network info."""
        client = x402Client()
        client.register("eip155:8453", MockSchemeClient("exact"))

        registered = client.get_registered_schemes()

        assert len(registered[2]) == 1
        info = registered[2][0]
        assert "scheme" in info
        assert "network" in info
        assert info["scheme"] == "exact"
        assert info["network"] == "eip155:8453"

    def test_separates_v1_and_v2(self):
        """Test that V1 and V2 schemes are in separate lists."""
        client = x402Client()
        client.register("eip155:8453", MockSchemeClient())
        client.register_v1("base-sepolia", MockSchemeClientV1())

        registered = client.get_registered_schemes()

        assert len(registered[2]) == 1
        assert len(registered[1]) == 1
        assert registered[2][0]["network"] == "eip155:8453"
        assert registered[1][0]["network"] == "base-sepolia"


# =============================================================================
# V1 Payload Creation Tests
# =============================================================================


class TestX402ClientV1PayloadCreation:
    """Tests for v1 payment payload creation via x402Client."""

    @pytest.mark.asyncio
    async def test_v1_create_payment_payload_async(self):
        """Test creating V1 payment payload through async client."""
        client = x402Client()
        mock_v1 = MockSchemeClientV1()
        client.register_v1("base-sepolia", mock_v1)

        payment_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )

        result = await client.create_payment_payload(payment_required)

        assert isinstance(result, PaymentPayloadV1)
        assert result.x402_version == 1
        assert result.scheme == "mock-v1"
        assert result.network == "base-sepolia"
        assert result.payload["mock"] == "v1-payload"

    def test_v1_create_payment_payload_sync(self):
        """Test creating V1 payment payload through sync client."""
        client = x402ClientSync()
        mock_v1 = MockSchemeClientV1()
        client.register_v1("base-sepolia", mock_v1)

        payment_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )

        result = client.create_payment_payload(payment_required)

        assert isinstance(result, PaymentPayloadV1)
        assert result.x402_version == 1
        assert result.scheme == "mock-v1"
        assert result.network == "base-sepolia"


class TestX402ClientAutoAdaptive:
    """Tests for auto-adaptive v1/v2 routing."""

    @pytest.mark.asyncio
    async def test_auto_adaptive_v1_response(self):
        """Client with both v1+v2 schemes routes v1 request to v1 scheme."""
        client = x402Client()
        mock_v2 = MockSchemeClient("mock")
        mock_v1 = MockSchemeClientV1("mock-v1")
        client.register("eip155:8453", mock_v2)
        client.register_v1("base-sepolia", mock_v1)

        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )

        result = await client.create_payment_payload(v1_required)

        assert isinstance(result, PaymentPayloadV1)
        assert result.x402_version == 1
        assert result.scheme == "mock-v1"
        # V2 mock should not have been called
        assert len(mock_v2.create_calls) == 0

    @pytest.mark.asyncio
    async def test_auto_adaptive_v2_response(self):
        """Same client routes v2 request to v2 scheme."""
        from bankofai.x402.schemas import PaymentPayload, PaymentRequired, PaymentRequirements

        client = x402Client()
        mock_v2 = MockSchemeClient("mock")
        mock_v1 = MockSchemeClientV1("mock-v1")
        client.register("eip155:8453", mock_v2)
        client.register_v1("base-sepolia", mock_v1)

        v2_required = PaymentRequired(
            x402_version=2,
            accepts=[
                PaymentRequirements(
                    scheme="mock",
                    network="eip155:8453",
                    asset="0x0000000000000000000000000000000000000000",
                    amount="1000000",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                ),
            ],
        )

        result = await client.create_payment_payload(v2_required)

        assert isinstance(result, PaymentPayload)
        assert result.x402_version == 2
        assert len(mock_v2.create_calls) == 1

    def test_auto_adaptive_sync_v1_then_v2(self):
        """Sync client auto-adapts: v1 request -> v1, v2 request -> v2."""
        from bankofai.x402.schemas import PaymentPayload, PaymentRequired, PaymentRequirements

        client = x402ClientSync()
        mock_v2 = MockSchemeClient("mock")
        mock_v1 = MockSchemeClientV1("mock-v1")
        client.register("eip155:8453", mock_v2)
        client.register_v1("base-sepolia", mock_v1)

        # V1 request
        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )
        result_v1 = client.create_payment_payload(v1_required)
        assert isinstance(result_v1, PaymentPayloadV1)
        assert result_v1.x402_version == 1

        # V2 request through same client
        v2_required = PaymentRequired(
            x402_version=2,
            accepts=[
                PaymentRequirements(
                    scheme="mock",
                    network="eip155:8453",
                    asset="0x0000000000000000000000000000000000000000",
                    amount="1000000",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                ),
            ],
        )
        result_v2 = client.create_payment_payload(v2_required)
        assert isinstance(result_v2, PaymentPayload)
        assert result_v2.x402_version == 2


class TestX402ClientV1Hooks:
    """Tests for hook execution on v1 path."""

    @pytest.mark.asyncio
    async def test_v1_before_hook_executes(self):
        """Verify before_payment_creation hooks fire for v1 path."""
        hook_called = False
        received_version = None

        def before_hook(ctx):
            nonlocal hook_called, received_version
            hook_called = True
            received_version = ctx.payment_required.x402_version
            return None

        client = x402Client()
        client.register_v1("base-sepolia", MockSchemeClientV1())
        client.on_before_payment_creation(before_hook)

        payment_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )

        await client.create_payment_payload(payment_required)

        assert hook_called is True
        assert received_version == 1

    @pytest.mark.asyncio
    async def test_v1_after_hook_executes(self):
        """Verify after_payment_creation hooks fire for v1 path."""
        hook_called = False
        received_payload = None

        def after_hook(ctx):
            nonlocal hook_called, received_payload
            hook_called = True
            received_payload = ctx.payment_payload

        client = x402Client()
        client.register_v1("base-sepolia", MockSchemeClientV1())
        client.on_after_payment_creation(after_hook)

        payment_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[
                PaymentRequirementsV1(
                    scheme="mock-v1",
                    network="base-sepolia",
                    max_amount_required="500000",
                    resource="https://example.com",
                    pay_to="0x1234567890123456789012345678901234567890",
                    max_timeout_seconds=300,
                    asset="0x0000000000000000000000000000000000000000",
                ),
            ],
        )

        await client.create_payment_payload(payment_required)

        assert hook_called is True
        assert received_payload is not None
        assert received_payload.x402_version == 1
