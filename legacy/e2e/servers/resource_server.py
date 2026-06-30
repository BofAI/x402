"""
Resource server fixture for e2e scenarios.

Configuration (all env vars):

    E2E_SERVER_HOST          bind host          (default 127.0.0.1)
    E2E_SERVER_PORT          bind port          (default 4021)
    E2E_FACILITATOR_URL      facilitator URL    (default http://127.0.0.1:4020)
    E2E_NETWORK              network identifier (default eip155:97)
    E2E_SCHEMES              comma-separated schemes (default "exact_permit,exact")
    E2E_PAY_TO               resource recipient address (default test key #1)
    E2E_ASSET_PRICE          price spec (default "0.0001 USDT")
    E2E_PROTECTED_PATH       endpoint path      (default /protected)
    E2E_SKIP_TX_VERIFICATION "1" to bypass post-settle on-chain verification
                             (needed for tron:* scenarios, where the mock
                             facilitator's deterministic tx hash is not a real
                             on-chain transaction)

Run: `python -m e2e.servers.resource_server`
"""

from __future__ import annotations

import os
import sys

from fastapi import FastAPI, Request

from bankofai.x402.config import NetworkConfig
from bankofai.x402.facilitator import FacilitatorClient
from bankofai.x402.fastapi import x402_protected
from bankofai.x402.server import X402Server


def _install_noop_tx_verifier_if_requested() -> None:
    """Replace `get_verifier_for_network` with a no-op for e2e scenarios.

    The middleware calls this function after a successful settle; if it raises
    `ValueError` the middleware falls through to "no verifier available, skip".
    We exploit that contract to skip verification for any network when the
    env flag is set, without touching SDK code.
    """
    if os.environ.get("E2E_SKIP_TX_VERIFICATION") != "1":
        return
    from bankofai.x402.utils import tx_verification

    def _always_raise(network: str, rpc_url: str | None = None):
        raise ValueError(f"e2e: tx verification disabled for {network}")

    tx_verification.get_verifier_for_network = _always_raise


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _schemes() -> list[str]:
    raw = _env("E2E_SCHEMES", "exact_permit,exact")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _register_mechanisms(server: X402Server, network: str, schemes: list[str]) -> None:
    for scheme in schemes:
        if scheme == "exact":
            if network.startswith("eip155:"):
                from bankofai.x402.mechanisms.evm.exact import ExactEvmServerMechanism

                server.register(network, ExactEvmServerMechanism())
            else:
                raise SystemExit(f"scheme 'exact' not supported for network {network}")
        elif scheme == "exact_permit":
            if network.startswith("eip155:"):
                from bankofai.x402.mechanisms.evm.exact_permit import (
                    ExactPermitEvmServerMechanism,
                )

                server.register(network, ExactPermitEvmServerMechanism())
            elif network.startswith("tron:"):
                from bankofai.x402.mechanisms.tron.exact_permit import (
                    ExactPermitTronServerMechanism,
                )

                server.register(network, ExactPermitTronServerMechanism())
            else:
                raise SystemExit(f"unknown network prefix: {network}")
        elif scheme == "exact_gasfree":
            if not network.startswith("tron:"):
                raise SystemExit(
                    f"scheme 'exact_gasfree' requires a tron:* network, got {network}"
                )
            from bankofai.x402.mechanisms.tron.exact_gasfree.server import (
                ExactGasFreeServerMechanism,
            )

            server.register(network, ExactGasFreeServerMechanism())
        else:
            raise SystemExit(f"unknown scheme: {scheme}")


def build_app() -> FastAPI:
    network = _env("E2E_NETWORK", NetworkConfig.BSC_TESTNET)
    schemes = _schemes()
    pay_to = _env("E2E_PAY_TO", "0x70997970C51812dc3A010C7d01b50e0d17dc79C8")
    prices_env = os.environ.get("E2E_ASSET_PRICES")
    if prices_env:
        prices = [p.strip() for p in prices_env.split(",") if p.strip()]
    else:
        price = _env("E2E_ASSET_PRICE", "0.0001 USDT")
        prices = [price] * len(schemes)
    if len(prices) != len(schemes):
        raise SystemExit(
            f"E2E_ASSET_PRICES length ({len(prices)}) must match E2E_SCHEMES length ({len(schemes)})"
        )
    facilitator_url = _env("E2E_FACILITATOR_URL", "http://127.0.0.1:4020")
    protected_path = _env("E2E_PROTECTED_PATH", "/protected")

    # Apply the tx-verification monkey-patch only during app construction, and only
    # when explicitly requested — keeps the side-effect scoped to this entry point.
    _install_noop_tx_verifier_if_requested()

    app = FastAPI(title="x402 e2e resource server")

    x402_server = X402Server()
    _register_mechanisms(x402_server, network, schemes)
    x402_server.set_facilitator(FacilitatorClient(facilitator_url))

    @app.get(protected_path)
    @x402_protected(
        server=x402_server,
        prices=prices,
        schemes=schemes,
        network=network,
        pay_to=pay_to,
    )
    async def protected(request: Request) -> dict[str, object]:
        return {"ok": True, "impl": "e2e-fixture-server", "network": network}

    return app


app = build_app()


def main() -> int:
    try:
        import uvicorn
    except ImportError:
        print(
            "uvicorn is required to run the resource server; install with `pip install uvicorn`",
            file=sys.stderr,
        )
        return 2

    host = _env("E2E_SERVER_HOST", "127.0.0.1")
    port = int(_env("E2E_SERVER_PORT", "4021"))

    uvicorn.run(
        "e2e.servers.resource_server:app",
        host=host,
        port=port,
        log_level=os.environ.get("E2E_SERVER_LOG_LEVEL", "warning"),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
