"""
FastAPI middleware for x402 payment processing
"""

from functools import wraps
from typing import TYPE_CHECKING, Any, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

from bankofai.x402.encoding import decode_payment_payload, encode_payment_payload
from bankofai.x402.server import ResourceConfig, X402Server
from bankofai.x402.types import PaymentPayload, PaymentRequirements, ReceiptSignatureData
from bankofai.x402.utils.address import checksum_evm_address

if TYPE_CHECKING:
    from bankofai.x402.utils.receipt_signer import SellerSigningConfig
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
        seller_signing: "SellerSigningConfig | None" = None,
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
            seller_signing: Optional SellerSigningConfig. When provided, the server
                constructs and returns an ECDSA receipt signature (EIP-191) alongside
                the data response. The buyer can submit this signature on-chain to
                PurchaseLog.logPurchase() as proof of purchase.

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
        if network.startswith("eip155:"):
            pay_to = checksum_evm_address(pay_to, strict=True)

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

                try:
                    requirements = (await self._server.build_payment_requirements([config]))[0]
                except Exception as e:
                    return JSONResponse(
                        content={"error": f"Invalid payment configuration: {str(e)}"},
                        status_code=500,
                    )

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

                # Sign receipt if seller_signing is configured
                if seller_signing and settle_result.transaction:
                    import hashlib

                    # paymentHash = SHA-256 of the PAYMENT-SIGNATURE header
                    # (the buyer's base64-encoded payment payload). This matches
                    # PurchaseLog.sol's spec: "SHA-256 of x402 X-Payment header".
                    payment_hash_bytes = hashlib.sha256(
                        payment_header.encode("utf-8")
                    ).hexdigest()

                    receipt_sig = self._sign_receipt(
                        request=request,
                        signing_config=seller_signing,
                        payment_hash=payment_hash_bytes,
                        amount=requirements.amount,
                        network=requirements.network,
                    )
                    if receipt_sig:
                        settle_result.receipt_signature = receipt_sig

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
    def _sign_receipt(
        request: Request,
        signing_config: "SellerSigningConfig",
        payment_hash: str,
        amount: str,
        network: str,
    ) -> ReceiptSignatureData | None:
        """Construct and sign the receipt digest for PurchaseLog verification.

        Returns None if signing fails (logs a warning but does not block the response).
        """
        import logging

        from bankofai.x402.config import NetworkConfig
        from bankofai.x402.utils.receipt_signer import sign_receipt

        logger = logging.getLogger(__name__)

        try:
            # Read buyer agent ID from request header (0 = anonymous)
            buyer_agent_id = 0
            header_val = request.headers.get(signing_config.buyer_agent_id_header)
            if header_val:
                buyer_agent_id = int(header_val)

            # Validate values fit in the PurchaseLog's packed struct types
            _UINT32_MAX = 2**32 - 1
            if signing_config.listing_id > _UINT32_MAX:
                logger.warning("listing_id %d exceeds uint32", signing_config.listing_id)
                return None
            if buyer_agent_id > _UINT32_MAX:
                logger.warning("buyer_agent_id %d exceeds uint32", buyer_agent_id)
                return None

            chain_id = NetworkConfig.get_chain_id(network)

            result = sign_receipt(
                private_key=signing_config.private_key,
                listing_id=signing_config.listing_id,
                buyer_agent_id=buyer_agent_id,
                payment_hash=payment_hash,
                amount=amount,
                chain_id=chain_id,
                contract_address=signing_config.purchase_log_address,
            )

            return ReceiptSignatureData(
                signature=result.signature,
                digest=result.digest,
                listingId=result.listing_id,
                buyerAgentId=result.buyer_agent_id,
                paymentHash=result.payment_hash,
                amount=result.amount,
                chainId=result.chain_id,
                contractAddress=result.contract_address,
            )
        except Exception as e:
            logger.warning("Receipt signing failed: %s", e, exc_info=True)
            return None

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
        try:
            requirements_list = await self._server.build_payment_requirements(configs)
        except Exception as e:
            return JSONResponse(
                content={"error": f"Invalid payment configuration: {str(e)}"},
                status_code=500,
            )
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
    seller_signing: "SellerSigningConfig | None" = None,
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

    With seller receipt signing (for PurchaseLog on-chain proof):
        @x402_protected(
            server,
            prices=["1 USDT"],
            schemes=["exact_permit"],
            network="tron:nile",
            pay_to="T...",
            seller_signing=SellerSigningConfig(
                private_key="0x...",
                listing_id=42,
                purchase_log_address="0x...",
            ),
        )
    """
    middleware = X402Middleware(server)
    return middleware.protect(
        prices=prices,
        schemes=schemes,
        network=network,
        pay_to=pay_to,
        seller_signing=seller_signing,
        **kwargs,
    )
