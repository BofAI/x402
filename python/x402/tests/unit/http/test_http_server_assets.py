"""Tests for assets passthrough in HTTP server payment option building."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from bankofai.x402.http.types import PaymentOption
from bankofai.x402.http.x402_http_server import x402HTTPResourceServer, x402HTTPResourceServerSync
from bankofai.x402.schemas.config import ResourceConfig


@pytest.fixture()
def mock_server() -> MagicMock:
    """Create a mock x402ResourceServer (async)."""
    server = MagicMock()
    server.build_payment_requirements.return_value = []
    return server


@pytest.fixture()
def mock_server_sync() -> MagicMock:
    """Create a mock x402ResourceServerSync."""
    server = MagicMock()
    server.build_payment_requirements.return_value = []
    return server


class TestAsyncAssetsPassthrough:
    """Tests for assets passthrough in async HTTP server."""

    @pytest.mark.asyncio()
    async def test_assets_passed_to_resource_config(self, mock_server: MagicMock) -> None:
        """Should pass assets from PaymentOption to ResourceConfig."""
        http_server = x402HTTPResourceServer(mock_server, {})

        option = PaymentOption(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
            assets=["USDC", "USDT"],
        )

        mock_context = MagicMock()
        await http_server._build_payment_requirements_from_options(option, mock_context, None)

        mock_server.build_payment_requirements.assert_called_once()
        config = mock_server.build_payment_requirements.call_args[0][0]
        assert isinstance(config, ResourceConfig)
        assert config.assets == ["USDC", "USDT"]

    @pytest.mark.asyncio()
    async def test_none_assets_passed_through(self, mock_server: MagicMock) -> None:
        """Should pass None assets when not specified."""
        http_server = x402HTTPResourceServer(mock_server, {})

        option = PaymentOption(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
        )

        mock_context = MagicMock()
        await http_server._build_payment_requirements_from_options(option, mock_context, None)

        config = mock_server.build_payment_requirements.call_args[0][0]
        assert config.assets is None

    @pytest.mark.asyncio()
    async def test_multiple_options_each_pass_assets(self, mock_server: MagicMock) -> None:
        """Should pass assets for each PaymentOption independently."""
        http_server = x402HTTPResourceServer(mock_server, {})

        options = [
            PaymentOption(
                scheme="exact",
                pay_to="0x123",
                price="$0.01",
                network="eip155:8453",
                assets=["USDC"],
            ),
            PaymentOption(
                scheme="exact",
                pay_to="0x456",
                price="$0.02",
                network="eip155:8453",
                assets=["USDT", "DAI"],
            ),
        ]

        mock_context = MagicMock()
        await http_server._build_payment_requirements_from_options(options, mock_context, None)

        assert mock_server.build_payment_requirements.call_count == 2
        config1 = mock_server.build_payment_requirements.call_args_list[0][0][0]
        config2 = mock_server.build_payment_requirements.call_args_list[1][0][0]
        assert config1.assets == ["USDC"]
        assert config2.assets == ["USDT", "DAI"]


class TestSyncAssetsPassthrough:
    """Tests for assets passthrough in sync HTTP server."""

    def test_assets_passed_to_resource_config(self, mock_server_sync: MagicMock) -> None:
        """Should pass assets from PaymentOption to ResourceConfig."""
        http_server = x402HTTPResourceServerSync(mock_server_sync, {})

        option = PaymentOption(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
            assets=["USDC", "USDT"],
        )

        mock_context = MagicMock()
        http_server._build_payment_requirements_from_options_sync(option, mock_context)

        mock_server_sync.build_payment_requirements.assert_called_once()
        config = mock_server_sync.build_payment_requirements.call_args[0][0]
        assert isinstance(config, ResourceConfig)
        assert config.assets == ["USDC", "USDT"]

    def test_none_assets_passed_through(self, mock_server_sync: MagicMock) -> None:
        """Should pass None assets when not specified."""
        http_server = x402HTTPResourceServerSync(mock_server_sync, {})

        option = PaymentOption(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
        )

        mock_context = MagicMock()
        http_server._build_payment_requirements_from_options_sync(option, mock_context)

        config = mock_server_sync.build_payment_requirements.call_args[0][0]
        assert config.assets is None
