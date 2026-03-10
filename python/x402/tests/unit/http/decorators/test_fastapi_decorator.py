"""Tests for FastAPI decorator-based x402 payment integration."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from bankofai.x402.http.decorators.fastapi import x402_app
from bankofai.x402.http.types import PaymentOption, RouteConfig


@pytest.fixture()
def mock_server() -> MagicMock:
    """Create a mock x402ResourceServer (async)."""
    server = MagicMock()
    server.build_payment_requirements.return_value = []
    return server


@pytest.fixture()
def x402(mock_server: MagicMock) -> x402_app:
    """Create an x402_app instance with mock server."""
    return x402_app(mock_server)


class TestPayDecorator:
    """Tests for the @x402.pay() decorator."""

    def test_single_option_via_keywords(self, x402: x402_app) -> None:
        """Should create a PaymentOption from keyword arguments."""

        @x402.pay(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
        )
        async def handler() -> dict:
            return {"ok": True}

        config = handler._x402_config  # type: ignore[attr-defined]
        assert isinstance(config, RouteConfig)
        assert isinstance(config.accepts, PaymentOption)
        assert config.accepts.scheme == "exact"

    def test_single_option_via_accepts(self, x402: x402_app) -> None:
        """Should accept a PaymentOption directly."""
        option = PaymentOption(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
        )

        @x402.pay(option)
        async def handler() -> dict:
            return {"ok": True}

        config = handler._x402_config  # type: ignore[attr-defined]
        assert config.accepts is option

    def test_multiple_options(self, x402: x402_app) -> None:
        """Should accept a list of PaymentOptions."""
        options = [
            PaymentOption(scheme="exact", pay_to="0x123", price="$0.01", network="eip155:8453"),
            PaymentOption(scheme="exact", pay_to="Txyz", price="$0.01", network="tron:728126428"),
        ]

        @x402.pay(options)
        async def handler() -> dict:
            return {"ok": True}

        config = handler._x402_config  # type: ignore[attr-defined]
        assert isinstance(config.accepts, list)
        assert len(config.accepts) == 2

    def test_assets_field(self, x402: x402_app) -> None:
        """Should pass assets field through PaymentOption."""

        @x402.pay(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
            assets=["USDC", "USDT"],
        )
        async def handler() -> dict:
            return {"ok": True}

        config = handler._x402_config  # type: ignore[attr-defined]
        assert config.accepts.assets == ["USDC", "USDT"]

    def test_route_metadata(self, x402: x402_app) -> None:
        """Should pass description and mime_type to RouteConfig."""

        @x402.pay(
            scheme="exact",
            pay_to="0x123",
            price="$0.01",
            network="eip155:8453",
            description="Weather API",
            mime_type="application/json",
        )
        async def handler() -> dict:
            return {"ok": True}

        config = handler._x402_config  # type: ignore[attr-defined]
        assert config.description == "Weather API"
        assert config.mime_type == "application/json"

    def test_raises_without_required_keywords(self, x402: x402_app) -> None:
        """Should raise ValueError when keyword args are incomplete."""
        with pytest.raises(ValueError, match="pay_to, price, and network are required"):

            @x402.pay(scheme="exact")
            async def handler() -> dict:
                return {"ok": True}

    def test_raises_without_any_args(self, x402: x402_app) -> None:
        """Should raise ValueError when no arguments provided."""
        with pytest.raises(ValueError, match="Either 'accepts'"):

            @x402.pay()
            async def handler() -> dict:
                return {"ok": True}


class TestInitApp:
    """Tests for x402_app.init_app()."""

    def test_registers_middleware_for_decorated_routes(self, mock_server: MagicMock) -> None:
        """Should scan FastAPI routes and register payment middleware."""
        pytest.importorskip("fastapi")
        from fastapi import FastAPI

        app = FastAPI()
        x402 = x402_app(mock_server)

        @app.get("/weather")
        @x402.pay(scheme="exact", pay_to="0x123", price="$0.01", network="eip155:8453")
        async def get_weather() -> dict:
            return {"report": "sunny"}

        with patch("bankofai.x402.http.middleware.fastapi.payment_middleware") as mock_pm:
            mock_pm.return_value = MagicMock()
            x402.init_app(app)

            mock_pm.assert_called_once()
            call_args = mock_pm.call_args
            routes = call_args[0][0]  # First positional arg is routes

            assert isinstance(routes, dict)
            assert len(routes) > 0
            route_keys = list(routes.keys())
            assert any("/weather" in k for k in route_keys)

    def test_skips_options_and_head_methods(self, mock_server: MagicMock) -> None:
        """Should not register OPTIONS or HEAD methods."""
        pytest.importorskip("fastapi")
        from fastapi import FastAPI

        app = FastAPI()
        x402 = x402_app(mock_server)

        @app.api_route("/test", methods=["GET", "POST"])
        @x402.pay(scheme="exact", pay_to="0x123", price="$0.01", network="eip155:8453")
        async def handler() -> dict:
            return {"ok": True}

        with patch("bankofai.x402.http.middleware.fastapi.payment_middleware") as mock_pm:
            mock_pm.return_value = MagicMock()
            x402.init_app(app)

            routes = mock_pm.call_args[0][0]
            route_methods = {k.split(" ")[0] for k in routes}
            assert "OPTIONS" not in route_methods
            assert "HEAD" not in route_methods

    def test_no_middleware_when_no_decorated_routes(self, mock_server: MagicMock) -> None:
        """Should not register middleware when no routes are decorated."""
        pytest.importorskip("fastapi")
        from fastapi import FastAPI

        app = FastAPI()
        x402 = x402_app(mock_server)

        @app.get("/free")
        async def free_route() -> dict:
            return {"free": True}

        with patch("bankofai.x402.http.middleware.fastapi.payment_middleware") as mock_pm:
            x402.init_app(app)
            mock_pm.assert_not_called()

    def test_passes_server_and_config(self, mock_server: MagicMock) -> None:
        """Should pass server and paywall_config to middleware."""
        pytest.importorskip("fastapi")
        from fastapi import FastAPI

        paywall_config = {"app_name": "TestApp"}
        app = FastAPI()
        x402 = x402_app(
            mock_server,
            paywall_config=paywall_config,
        )

        @app.get("/test")
        @x402.pay(scheme="exact", pay_to="0x123", price="$0.01", network="eip155:8453")
        async def handler() -> dict:
            return {"ok": True}

        with patch("bankofai.x402.http.middleware.fastapi.payment_middleware") as mock_pm:
            mock_pm.return_value = MagicMock()
            x402.init_app(app)

            call_args = mock_pm.call_args
            assert call_args[0][1] is mock_server
            assert call_args[1]["paywall_config"] is paywall_config
