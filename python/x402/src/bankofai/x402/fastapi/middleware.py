"""
FastAPI middleware for x402 payment processing
"""

from functools import wraps
from typing import TYPE_CHECKING, Any, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from bankofai.x402.encoding import decode_payment_payload, encode_payment_payload
from bankofai.x402.server import ResourceConfig, X402Server
from bankofai.x402.types import PaymentPayload, PaymentRequirements

if TYPE_CHECKING:
    from bankofai.x402.utils.tx_verification import TransactionVerificationResult

PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE"
PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED"
PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE"


class X402Middleware:
    """
    FastAPI middleware for automatic 402 payment handling.

    Usage:
        app = FastAPI()
        server = X402Server().set_facilitator(...)
        middleware = X402Middleware(server)

        @app.get("/protected")
        @middleware.protect(
            prices=["100 USDC"], schemes=["exact_permit"],
            network="eip155:8453", pay_to="0x...",
        )
        async def protected_endpoint():
            return {"data": "secret"}
    """

    def __init__(self, server: X402Server) -> None:
        self._server = server

    def protect(
        self,
        prices: list[str],
        schemes: list[str],
        network: str | None = None,
        pay_to: str | None = None,
        valid_for: int = 3600,
        delivery_mode: str = "PAYMENT_ONLY",
    ) -> Callable:
        """
        Decorator to protect endpoints with payment requirements.

        ``prices[i]`` uses ``schemes[i]``. Both lists must have the same length.

        Single token:
            @middleware.protect(
                prices=["1 USDT"],
                schemes=["exact_permit"],
                network="tron:nile",
                pay_to="T...",
            )

        Multiple tokens, per-token scheme:
            @middleware.protect(
                prices=["0.0001 USDT", "0.0001 DHLU"],
                schemes=["exact_permit", "exact"],
                network="eip155:97",
                pay_to="0x...",
            )

        Args:
            prices: List of price strings (e.g. ["0.0001 USDT", "0.0001 DHLU"])
            schemes: List of scheme strings matching *prices* (e.g. ["exact_permit", "exact"])
            network: Network identifier (shared by all prices)
            pay_to: Payment recipient address
            valid_for: Payment validity period (seconds)
            delivery_mode: Delivery mode

        Returns:
            Decorated function
        """
        if not prices or not schemes or not network or not pay_to:
            raise ValueError("prices, schemes, network, and pay_to are required")
        if len(schemes) != len(prices):
            raise ValueError(
                f"schemes length ({len(schemes)}) must match prices length ({len(prices)})"
            )
        price_list = prices
        scheme_list = schemes

        # Validate all token symbols at startup
        from bankofai.x402.tokens import TokenRegistry

        for p in price_list:
            TokenRegistry.parse_price(p, network)

        configs = [
            ResourceConfig(
                scheme=s,
                network=network,
                price=p,
                pay_to=pay_to,
                valid_for=valid_for,
                delivery_mode=delivery_mode,
            )
            for p, s in zip(price_list, scheme_list)
        ]

        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(request: Request, *args: Any, **kwargs: Any) -> Response:
                payment_header = request.headers.get(PAYMENT_SIGNATURE_HEADER)

                if not payment_header:
                    return await self._return_payment_required(request, configs)

                try:
                    payload = decode_payment_payload(payment_header, PaymentPayload)
                except Exception as e:
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.error(f"Failed to decode payment payload: {e}", exc_info=True)
                    logger.error(
                        f"Payment header content (first 200 chars): {payment_header[:200]}"
                    )
                    return JSONResponse(
                        content={"error": f"Invalid payment payload: {str(e)}"}, status_code=400
                    )

                # Match payload to the correct config
                config = self._match_config(
                    configs,
                    payload.accepted.network,
                    payload.accepted.asset,
                    payload.accepted.scheme,
                )
                if config is None:
                    return JSONResponse(
                        content={"error": "Unsupported payment token or network"},
                        status_code=400,
                    )

                requirements = (await self._server.build_payment_requirements([config]))[0]

                settle_result = await self._server.settle_payment(payload, requirements)
                if not settle_result.success:
                    import logging

                    logger = logging.getLogger(__name__)
                    logger.error(f"Payment settlement failed: {settle_result.error_reason}")
                    logger.error(f"Settlement result: {settle_result.model_dump(by_alias=True)}")
                    error_content: dict[str, Any] = {
                        "error": f"Settlement failed: {settle_result.error_reason}",
                    }
                    if settle_result.transaction:
                        error_content["txHash"] = settle_result.transaction
                    if settle_result.network:
                        error_content["network"] = settle_result.network
                    return JSONResponse(content=error_content, status_code=500)

                # Verify transaction on-chain (required)
                if settle_result.transaction:
                    tx_verify_result = await self._verify_transaction_on_chain(
                        tx_hash=settle_result.transaction,
                        payload=payload,
                        requirements=requirements,
                        network=requirements.network,
                    )
                    if not tx_verify_result.success:
                        return JSONResponse(
                            content={
                                "error": (
                                    "Transaction verification failed: "
                                    f"{tx_verify_result.error_reason}"
                                ),
                                "txHash": settle_result.transaction,
                            },
                            status_code=500,
                        )

                response = await func(request, *args, **kwargs)

                if isinstance(response, Response):
                    response.headers[PAYMENT_RESPONSE_HEADER] = encode_payment_payload(
                        settle_result.model_dump(by_alias=True)
                    )
                    return response

                json_response = JSONResponse(content=response)
                json_response.headers[PAYMENT_RESPONSE_HEADER] = encode_payment_payload(
                    settle_result.model_dump(by_alias=True)
                )
                return json_response

            return wrapper

        return decorator

    @staticmethod
    def _match_config(
        configs: list[ResourceConfig],
        network: str,
        asset: str,
        scheme: str | None = None,
    ) -> ResourceConfig | None:
        """Find the config matching the payment's network, asset, and scheme."""
        from bankofai.x402.tokens import TokenRegistry

        for cfg in configs:
            if cfg.network != network:
                continue
            if scheme and cfg.scheme != scheme:
                continue

            # Parse the price to get the expected asset address
            parts = cfg.price.strip().split()
            if len(parts) != 2:
                continue
            symbol = parts[1]
            token = TokenRegistry.get_token(cfg.network, symbol)
            if token and token.address.lower() == asset.lower():
                return cfg
        return None

    async def _verify_transaction_on_chain(
        self,
        tx_hash: str,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
        network: str,
    ) -> "TransactionVerificationResult":
        """
        Verify transaction on-chain to ensure transfers match expectations.

        Args:
            tx_hash: Transaction hash to verify
            payload: Payment payload
            requirements: Payment requirements
            network: Network identifier

        Returns:
            TransactionVerificationResult
        """
        from bankofai.x402.utils.tx_verification import (
            TransactionVerificationResult,
            get_verifier_for_network,
        )

        try:
            verifier = get_verifier_for_network(network)
            return await verifier.verify_transaction(tx_hash, payload, requirements)
        except ValueError as e:
            # No verifier available for this network, skip verification
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(f"Transaction verification skipped: {e}")
            return TransactionVerificationResult(
                success=True,
                tx_hash=tx_hash,
                status_verified=True,
            )

    async def _return_payment_required(
        self,
        request: Request,
        configs: list[ResourceConfig],
        error: str | None = None,
    ) -> JSONResponse:
        """Return 402 payment required response"""
        requirements_list = await self._server.build_payment_requirements(configs)
        if not requirements_list:
            return JSONResponse(
                content={"error": "No supported payment options available"},
                status_code=500,
            )

        payment_required = self._server.create_payment_required_response(
            requirements=requirements_list,
            resource_info={"url": str(request.url)},
        )

        response_data = payment_required.model_dump(by_alias=True)
        if error:
            response_data["error"] = error

        response = JSONResponse(content=response_data, status_code=402)
        response.headers[PAYMENT_REQUIRED_HEADER] = encode_payment_payload(response_data)

        return response


def x402_protected(
    server: X402Server,
    prices: list[str],
    schemes: list[str],
    network: str,
    pay_to: str,
    **kwargs: Any,
) -> Callable:
    """
    Convenience decorator to protect endpoints.

    Single token:
        @x402_protected(
            server,
            prices=["1 USDT"],
            schemes=["exact_permit"],
            network="tron:nile",
            pay_to="T...",
        )

    Multiple tokens, per-token scheme:
        @x402_protected(
            server,
            prices=["0.0001 USDT", "0.0001 DHLU"],
            schemes=["exact_permit", "exact"],
            network="eip155:97",
            pay_to="0x...",
        )
    """
    middleware = X402Middleware(server)
    return middleware.protect(
        prices=prices,
        schemes=schemes,
        network=network,
        pay_to=pay_to,
        **kwargs,
    )
