"""
Tests for GasFree utility functions.
"""

import base64
import hmac
from unittest.mock import AsyncMock, patch

import pytest

from bankofai.x402.utils.gasfree import GasFreeAPIClient, get_gasfree_domain


class TestGasFreeAPIClient:
    def test_generate_signature(self):
        client = GasFreeAPIClient(
            "https://api.example.com", api_key="test-key", api_secret="test-secret"
        )
        timestamp = 1234567890
        method = "GET"
        path = "/api/v1/test"

        expected_msg = f"{method}{path}{timestamp}"
        expected_signature_bytes = hmac.new(
            b"test-secret", expected_msg.encode("utf-8"), digestmod="sha256"
        ).digest()
        expected_signature = base64.b64encode(expected_signature_bytes).decode("utf-8")

        sig = client._generate_signature(method, path, timestamp)
        assert sig == expected_signature

    def test_get_headers(self):
        client = GasFreeAPIClient(
            "https://api.example.com", api_key="test-key", api_secret="test-secret"
        )
        with patch("time.time", return_value=1234567890):
            headers = client._get_headers("GET", "/api/v1/test")

        assert headers["Content-Type"] == "application/json"
        assert headers["Timestamp"] == "1234567890"
        assert headers["Authorization"].startswith("ApiKey test-key:")

    @pytest.mark.anyio
    async def test_get_address_info(self):
        client = GasFreeAPIClient("https://api.example.com")
        mock_response = {
            "code": 200,
            "data": {"accountAddress": "0x123", "gasFreeAddress": "0x456", "nonce": 5},
        }

        with patch("httpx.AsyncClient.get") as mock_get:
            mock_get.return_value = AsyncMock(
                status_code=200, json=lambda: mock_response, raise_for_status=lambda: None
            )
            info = await client.get_address_info("0x123")

        assert info["gasFreeAddress"] == "0x456"
        assert info["nonce"] == 5

    @pytest.mark.anyio
    async def test_submit(self):
        client = GasFreeAPIClient("https://api.example.com")
        mock_response = {"code": 200, "data": {"id": "trace-123"}}

        message = {
            "token": "0xtoken",
            "serviceProvider": "0xprovider",
            "user": "0xuser",
            "receiver": "0xreceiver",
            "value": "100",
            "maxFee": "10",
            "deadline": 1000,
            "version": 1,
            "nonce": 1,
        }

        with patch("httpx.AsyncClient.post") as mock_post:
            mock_post.return_value = AsyncMock(
                status_code=200, json=lambda: mock_response, raise_for_status=lambda: None
            )
            trace_id = await client.submit(domain={}, message=message, signature="0xabc")

        assert trace_id == "trace-123"


def test_get_gasfree_domain():
    domain = get_gasfree_domain(1, "THKbWd2g5aS9tY59xk8hp5xMnbE8m3B3E")
    assert domain["name"] == "GasFreeController"
    assert domain["chainId"] == 1
    assert domain["verifyingContract"].startswith("0x")
