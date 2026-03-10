"""FastAPI decorator-based API for x402 payment protection.

Provides a declarative way to protect FastAPI routes with x402 payment
requirements using decorators, as an alternative to the routes dict approach.

Example:
    ```python
    from bankofai.x402.http.decorators.fastapi import x402_app
    from bankofai.x402.http import PaymentOption

    x402 = x402_app(server)

    @app.get("/weather")
    @x402.pay(scheme="exact", network="eip155:8453", pay_to=ADDR, price="$0.01")
    async def get_weather():
        return {"report": "sunny"}

    # Multiple payment options
    @app.get("/premium")
    @x402.pay([
        PaymentOption(scheme="exact", network="eip155:8453", pay_to=evm, price="$0.01"),
        PaymentOption(scheme="exact", network="tron:728126428", pay_to=trx, price="$0.01"),
    ])
    async def get_premium():
        return {"data": "premium"}

    x402.init_app(app)
    ```
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from ..types import PaymentOption, RouteConfig

if TYPE_CHECKING:
    from fastapi import FastAPI

    from ...server import x402ResourceServer
    from ..types import PaywallConfig
    from ..x402_http_server import PaywallProvider


class x402_app:
    """FastAPI decorator-based x402 payment integration.

    Collects payment configurations from decorated route functions,
    then registers them as middleware when init_app() is called.

    Args:
        server: Pre-configured x402ResourceServer instance (async).
        paywall_config: Optional paywall UI configuration.
        paywall_provider: Optional custom paywall provider.
        sync_facilitator_on_start: Fetch facilitator support on first request.
    """

    def __init__(
        self,
        server: x402ResourceServer,
        paywall_config: PaywallConfig | None = None,
        paywall_provider: PaywallProvider | None = None,
        sync_facilitator_on_start: bool = True,
    ) -> None:
        self._server = server
        self._paywall_config = paywall_config
        self._paywall_provider = paywall_provider
        self._sync_facilitator_on_start = sync_facilitator_on_start
        self._decorated_functions: list[tuple[Callable[..., Any], RouteConfig]] = []

    def pay(
        self,
        accepts: PaymentOption | list[PaymentOption] | None = None,
        *,
        scheme: str | None = None,
        pay_to: str | None = None,
        price: str | None = None,
        network: str | None = None,
        assets: list[str] | None = None,
        max_timeout_seconds: int | None = None,
        extra: dict[str, Any] | None = None,
        description: str | None = None,
        mime_type: str | None = None,
        extensions: dict[str, Any] | None = None,
    ) -> Callable[..., Any]:
        """Decorator to mark a FastAPI route as payment-protected.

        Can be used with a PaymentOption / list of PaymentOptions, or with
        keyword arguments for a single payment option.

        Args:
            accepts: PaymentOption or list of PaymentOptions.
            scheme: Payment scheme (shorthand for single option).
            pay_to: Recipient address (shorthand for single option).
            price: Price string (shorthand for single option).
            network: CAIP-2 network identifier (shorthand for single option).
            assets: Asset symbols to resolve via AssetRegistry.
            max_timeout_seconds: Maximum payment timeout.
            extra: Scheme-specific additional data.
            description: Route description.
            mime_type: Response MIME type.
            extensions: Extension declarations.

        Returns:
            Decorated function (unchanged).
        """
        if accepts is None and scheme is not None:
            if pay_to is None or price is None or network is None:
                msg = "pay_to, price, and network are required when using keyword arguments"
                raise ValueError(msg)
            accepts = PaymentOption(
                scheme=scheme,
                pay_to=pay_to,
                price=price,
                network=network,
                assets=assets,
                max_timeout_seconds=max_timeout_seconds,
                extra=extra,
            )

        if accepts is None:
            msg = (
                "Either 'accepts' (PaymentOption or list) or keyword arguments "
                "(scheme, pay_to, price, network) must be provided"
            )
            raise ValueError(msg)

        route_config = RouteConfig(
            accepts=accepts,
            description=description,
            mime_type=mime_type,
            extensions=extensions,
        )

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            func._x402_config = route_config  # type: ignore[attr-defined]
            self._decorated_functions.append((func, route_config))
            return func

        return decorator

    def init_app(self, app: FastAPI) -> None:
        """Scan decorated routes and attach payment middleware.

        Must be called after all routes are registered with the FastAPI app.
        Iterates over registered API routes, matches them with decorated
        functions, and builds the routes config for the payment middleware.

        Args:
            app: FastAPI application instance.
        """
        from ..middleware.fastapi import payment_middleware

        routes: dict[str, RouteConfig] = {}

        for route in app.routes:
            # FastAPI APIRoute has endpoint and methods attributes
            endpoint = getattr(route, "endpoint", None)
            if endpoint is None:
                continue

            config = getattr(endpoint, "_x402_config", None)
            if config is None:
                continue

            methods = getattr(route, "methods", set())
            path = getattr(route, "path", "")

            for method in methods:
                if method in ("OPTIONS", "HEAD"):
                    continue
                key = f"{method} {path}"
                routes[key] = config

        if not routes:
            return

        middleware_func = payment_middleware(
            routes,
            self._server,
            paywall_config=self._paywall_config,
            paywall_provider=self._paywall_provider,
            sync_facilitator_on_start=self._sync_facilitator_on_start,
        )

        @app.middleware("http")
        async def x402_middleware(request: Any, call_next: Any) -> Any:
            return await middleware_func(request, call_next)
