"""V1 compatibility integration tests - parameterized for both sync and async.

Tests the v1 payment flow and auto-adaptive v1/v2 routing through
the full client pipeline using mock "cash" scheme.
"""

from __future__ import annotations

import asyncio

import pytest

from bankofai.x402 import x402Client, x402ClientSync
from bankofai.x402.schemas import PaymentPayload, PaymentRequired
from bankofai.x402.schemas.v1 import PaymentPayloadV1, PaymentRequiredV1

from ..mocks import (
    CashSchemeNetworkClient,
    CashSchemeNetworkClientV1,
    build_cash_payment_requirements,
    build_cash_payment_requirements_v1,
)

# =============================================================================
# Test Fixture Wrappers
# =============================================================================


@pytest.fixture(params=["sync", "async"])
def v1_client(request: pytest.FixtureRequest):
    """Fixture providing both sync and async clients with v1 cash scheme."""
    if request.param == "sync":
        client = x402ClientSync()
        client.register_v1("x402:cash", CashSchemeNetworkClientV1("John"))
        return client, False
    else:
        client = x402Client()
        client.register_v1("x402:cash", CashSchemeNetworkClientV1("John"))
        return client, True


@pytest.fixture(params=["sync", "async"])
def dual_client(request: pytest.FixtureRequest):
    """Fixture providing both sync and async clients with v1+v2 cash schemes."""
    if request.param == "sync":
        client = x402ClientSync()
        client.register("x402:cash", CashSchemeNetworkClient("John"))
        client.register_v1("x402:cash", CashSchemeNetworkClientV1("John"))
        return client, False
    else:
        client = x402Client()
        client.register("x402:cash", CashSchemeNetworkClient("John"))
        client.register_v1("x402:cash", CashSchemeNetworkClientV1("John"))
        return client, True


def _run(coro_or_result, is_async: bool):
    """Helper to run async or return sync result."""
    if is_async:
        return asyncio.run(coro_or_result)
    return coro_or_result


# =============================================================================
# V1 Flow Tests
# =============================================================================


class TestV1PaymentFlow:
    """Test complete V1 payment flow through client."""

    def test_v1_creates_valid_payload(self, v1_client) -> None:
        """V1 client creates PaymentPayloadV1 from PaymentRequiredV1."""
        client, is_async = v1_client

        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[build_cash_payment_requirements_v1("Merchant", "USD", "10")],
        )

        payload = _run(client.create_payment_payload(v1_required), is_async)

        assert isinstance(payload, PaymentPayloadV1)
        assert payload.x402_version == 1
        assert payload.scheme == "cash"
        assert payload.network == "x402:cash"
        assert payload.payload["signature"] == "~John"
        assert payload.payload["name"] == "John"
        assert "validUntil" in payload.payload

    def test_v1_payload_structure(self, v1_client) -> None:
        """V1 payload has scheme+network at top level (not nested in accepted)."""
        client, is_async = v1_client

        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[build_cash_payment_requirements_v1("Merchant", "USD", "5")],
        )

        payload = _run(client.create_payment_payload(v1_required), is_async)

        # V1 specific: scheme and network at top level
        assert payload.get_scheme() == "cash"
        assert payload.get_network() == "x402:cash"


# =============================================================================
# Auto-Adaptive Tests
# =============================================================================


class TestAutoAdaptiveRouting:
    """Test that a single client with v1+v2 schemes routes correctly."""

    def test_v1_request_routes_to_v1(self, dual_client) -> None:
        """V1 PaymentRequired routes to V1 scheme, produces PaymentPayloadV1."""
        client, is_async = dual_client

        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[build_cash_payment_requirements_v1("Merchant", "USD", "10")],
        )

        payload = _run(client.create_payment_payload(v1_required), is_async)

        assert isinstance(payload, PaymentPayloadV1)
        assert payload.x402_version == 1

    def test_v2_request_routes_to_v2(self, dual_client) -> None:
        """V2 PaymentRequired routes to V2 scheme, produces PaymentPayload."""
        client, is_async = dual_client

        v2_required = PaymentRequired(
            x402_version=2,
            accepts=[build_cash_payment_requirements("Merchant", "USD", "10")],
        )

        payload = _run(client.create_payment_payload(v2_required), is_async)

        assert isinstance(payload, PaymentPayload)
        assert payload.x402_version == 2
        assert payload.accepted.scheme == "cash"

    def test_sequential_v1_then_v2(self, dual_client) -> None:
        """Same client handles v1 then v2 request sequentially."""
        client, is_async = dual_client

        # V1 first
        v1_required = PaymentRequiredV1(
            x402_version=1,
            accepts=[build_cash_payment_requirements_v1("Merchant A", "USD", "5")],
        )
        payload_v1 = _run(client.create_payment_payload(v1_required), is_async)
        assert isinstance(payload_v1, PaymentPayloadV1)

        # V2 second
        v2_required = PaymentRequired(
            x402_version=2,
            accepts=[build_cash_payment_requirements("Merchant B", "USD", "10")],
        )
        payload_v2 = _run(client.create_payment_payload(v2_required), is_async)
        assert isinstance(payload_v2, PaymentPayload)


# =============================================================================
# HTTP Layer V1 Tests
# =============================================================================


class TestV1HTTPLayer:
    """Test V1 flow through HTTP layer."""

    def test_handle_402_response_v1(self) -> None:
        """V1 body -> PaymentRequiredV1 -> PaymentPayloadV1 -> X-PAYMENT header."""
        import json

        from bankofai.x402.http.constants import X_PAYMENT_HEADER
        from bankofai.x402.http.x402_http_client import x402HTTPClientSync

        client = x402ClientSync()
        client.register_v1("base-sepolia", CashSchemeNetworkClientV1("Alice"))
        http_client = x402HTTPClientSync(client)

        v1_body = {
            "x402Version": 1,
            "accepts": [
                {
                    "scheme": "cash",
                    "network": "base-sepolia",
                    "maxAmountRequired": "500000",
                    "resource": "https://example.com",
                    "payTo": "0x1234567890123456789012345678901234567890",
                    "maxTimeoutSeconds": 300,
                    "asset": "0x0000000000000000000000000000000000000000",
                }
            ],
        }
        body_bytes = json.dumps(v1_body).encode("utf-8")

        payment_headers, payload = http_client.handle_402_response({}, body_bytes)

        assert X_PAYMENT_HEADER in payment_headers
        assert isinstance(payload, PaymentPayloadV1)
        assert payload.x402_version == 1

    def test_round_tripper_v1(self) -> None:
        """PaymentRoundTripper handles V1 402 response."""
        import json

        from bankofai.x402.http.constants import X_PAYMENT_HEADER
        from bankofai.x402.http.x402_http_client import (
            PaymentRoundTripper,
            x402HTTPClientSync,
        )

        client = x402ClientSync()
        client.register_v1("base-sepolia", CashSchemeNetworkClientV1("Bob"))
        http_client = x402HTTPClientSync(client)
        tripper = PaymentRoundTripper(http_client)

        v1_body = json.dumps(
            {
                "x402Version": 1,
                "accepts": [
                    {
                        "scheme": "cash",
                        "network": "base-sepolia",
                        "maxAmountRequired": "500000",
                        "resource": "https://example.com",
                        "payTo": "0x1234567890123456789012345678901234567890",
                        "maxTimeoutSeconds": 300,
                        "asset": "0x0000000000000000000000000000000000000000",
                    }
                ],
            }
        ).encode("utf-8")

        retry_called_with = []

        def retry_func(payment_headers):
            retry_called_with.append(payment_headers)
            return "retry_response"

        result = tripper.handle_response(
            request_id="v1_req",
            status_code=402,
            headers={},
            body=v1_body,
            retry_func=retry_func,
        )

        assert result == "retry_response"
        assert len(retry_called_with) == 1
        assert X_PAYMENT_HEADER in retry_called_with[0]
