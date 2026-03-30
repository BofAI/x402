"""
Tests for create_async_tron_client fallback RPC URL behavior.
"""

from unittest.mock import MagicMock, patch

import pytest
from tronpy.providers.async_http import AsyncHTTPProvider

from bankofai.x402.utils.tron_client import create_async_tron_client

FALLBACK_URL = "https://hptg.bankofai.io"


class TestCreateAsyncTronClientFallback:
    """Tests for RPC URL selection based on TRON_GRID_API_KEY."""

    @patch("bankofai.x402.utils.tron_client.AsyncTron")
    @patch("bankofai.x402.utils.tron_client.AsyncHTTPProvider")
    @patch.dict("os.environ", {}, clear=True)
    def test_mainnet_uses_fallback_url_without_api_key(self, mock_provider_cls, mock_tron_cls):
        """When TRON_GRID_API_KEY is not set, mainnet should use the fallback RPC URL."""
        mock_provider = MagicMock()
        mock_provider_cls.return_value = mock_provider

        create_async_tron_client("mainnet")

        mock_provider_cls.assert_called_once_with(endpoint_uri="https://hptg.bankofai.io")
        mock_tron_cls.assert_called_once_with(provider=mock_provider, network="mainnet")

    @patch("bankofai.x402.utils.tron_client.AsyncTron")
    @patch("bankofai.x402.utils.tron_client.AsyncHTTPProvider")
    @patch.dict("os.environ", {}, clear=True)
    def test_mainnet_with_tron_prefix_uses_fallback(self, mock_provider_cls, mock_tron_cls):
        """tron:mainnet prefix should be stripped and fallback URL used."""
        mock_provider = MagicMock()
        mock_provider_cls.return_value = mock_provider

        create_async_tron_client("tron:mainnet")

        mock_provider_cls.assert_called_once_with(endpoint_uri="https://hptg.bankofai.io")
        mock_tron_cls.assert_called_once_with(provider=mock_provider, network="mainnet")

    @patch("bankofai.x402.utils.tron_client.AsyncTron")
    @patch.dict("os.environ", {}, clear=True)
    def test_nile_uses_default_without_api_key(self, mock_tron_cls):
        """Non-mainnet networks should use tronpy defaults when API key is not set."""
        create_async_tron_client("nile")

        mock_tron_cls.assert_called_once_with(network="nile")

    @patch("bankofai.x402.utils.tron_client.AsyncTron")
    @patch("bankofai.x402.utils.tron_client.AsyncHTTPProvider")
    @patch("bankofai.x402.utils.tron_client.conf_for_name")
    @patch.dict("os.environ", {"TRON_GRID_API_KEY": "test-key"})
    def test_mainnet_uses_trongrid_with_api_key(self, mock_conf, mock_provider_cls, mock_tron_cls):
        """When TRON_GRID_API_KEY is set, mainnet should use the TronGrid URL."""
        mock_conf.return_value = {"fullnode": "https://api.trongrid.io"}
        mock_provider = MagicMock()
        mock_provider_cls.return_value = mock_provider

        create_async_tron_client("mainnet")

        mock_provider_cls.assert_called_once_with(
            endpoint_uri="https://api.trongrid.io", api_key="test-key"
        )
        mock_tron_cls.assert_called_once_with(provider=mock_provider, network="mainnet")


class TestFallbackClientFunctional:
    """Verify the fallback client actually connects to the correct endpoint."""

    @patch.dict("os.environ", {}, clear=True)
    def test_fallback_client_has_correct_rpc_url(self):
        """Without API key, mainnet client provider must point to the fallback URL."""
        client = create_async_tron_client("tron:mainnet")
        assert isinstance(client.provider, AsyncHTTPProvider)
        assert client.provider.endpoint_uri == FALLBACK_URL

    @pytest.mark.anyio
    @patch.dict("os.environ", {}, clear=True)
    async def test_fallback_client_can_fetch_block(self):
        """The fallback client should be able to fetch the latest block."""
        client = create_async_tron_client("tron:mainnet")
        assert client.provider.endpoint_uri == FALLBACK_URL
        async with client:
            block = await client.get_latest_block()
            assert block is not None
            assert block["block_header"]["raw_data"]["number"] > 0
