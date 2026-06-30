"""
X402HttpClient - HTTP client adapter with automatic 402 payment handling
"""

import logging
from typing import Any

import httpx

from bankofai.x402.clients.x402_client import PaymentRequirementsSelector, X402Client
from bankofai.x402.encoding import decode_payment_payload, encode_payment_payload
from bankofai.x402.types import PaymentPayload, PaymentRequired

logger = logging.getLogger(__name__)


PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE"
PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED"
PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE"


class X402HttpClient:
    """
    HTTP client adapter with automatic 402 payment handling.

    Wraps httpx.AsyncClient to automatically handle 402 Payment Required responses.
    """

    def __init__(
        self,
        http_client: httpx.AsyncClient,
        x402_client: X402Client,
        selector: PaymentRequirementsSelector | None = None,
    ) -> None:
        """
        Initialize HTTP client adapter.

        Args:
            http_client: httpx.AsyncClient instance
            x402_client: X402Client instance
            selector: Custom payment requirements selector (optional)
        """
        self._http_client = http_client
        self._x402_client = x402_client
        self._selector = selector

    async def request_with_payment(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """
        Make HTTP request with automatic 402 payment handling.

        Args:
            method: HTTP method (GET, POST, etc.)
            url: Request URL
            **kwargs: Additional httpx request parameters

        Returns:
            httpx.Response

        Flow:
            1. Send original request
            2. If 402, parse PaymentRequired
            3. Create payment payload
            4. Retry with PAYMENT-SIGNATURE header
        """
        logger.info(f"Making {method} request to {url}")
        response = await self._http_client.request(method, url, **kwargs)
        logger.info(f"Received response: status={response.status_code}")

        if response.status_code != 402:
            logger.debug("Non-402 response, returning directly")
            return response

        logger.info("Received 402 Payment Required, processing payment...")
        logger.debug(f"Response headers: {dict(response.headers)}")

        try:
            response_text = response.text
            logger.debug(f"Response body: {response_text[:500]}")  # Log first 500 chars
        except Exception as e:
            logger.warning(f"Could not read response body: {e}")

        payment_required = self._parse_payment_required(response)
        if payment_required is None:
            logger.error("Failed to parse PaymentRequired from 402 response")
            return response

        logger.info(f"Parsed PaymentRequired with {len(payment_required.accepts)} payment options")

        extensions_dict = None
        if payment_required.extensions:
            extensions_dict = payment_required.extensions.model_dump(by_alias=True)
            logger.debug(f"Payment extensions: {extensions_dict}")

        try:
            payment_payload = await self._x402_client.handle_payment(
                payment_required.accepts,
                url,
                extensions_dict,
                self._selector,
            )
            logger.info("Payment payload created, retrying request with payment")
        except Exception as e:
            logger.error(f"Failed to create payment payload: {e}", exc_info=True)
            raise

        return await self._retry_with_payment(method, url, payment_payload, kwargs)

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        """GET request with payment handling"""
        return await self.request_with_payment("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        """POST request with payment handling"""
        return await self.request_with_payment("POST", url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        """PUT request with payment handling"""
        return await self.request_with_payment("PUT", url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        """DELETE request with payment handling"""
        return await self.request_with_payment("DELETE", url, **kwargs)

    def _parse_payment_required(self, response: httpx.Response) -> PaymentRequired | None:
        """Parse PaymentRequired from 402 response"""
        logger.debug("Attempting to parse PaymentRequired from response")

        header_value = response.headers.get(PAYMENT_REQUIRED_HEADER)
        if header_value:
            logger.debug(f"Found {PAYMENT_REQUIRED_HEADER} header, attempting to decode")
            try:
                payment_required = decode_payment_payload(header_value, PaymentRequired)
                logger.info("Successfully parsed PaymentRequired from header")
                return payment_required
            except Exception as e:
                logger.warning(f"Failed to decode PaymentRequired from header: {e}")

        logger.debug("Attempting to parse PaymentRequired from response body")
        try:
            body = response.json()
            keys = body.keys() if isinstance(body, dict) else "not a dict"
            logger.debug("Response body JSON keys: %s", keys)
            if "accepts" in body and isinstance(body["accepts"], list):
                payment_required = PaymentRequired(**body)
                logger.info("Successfully parsed PaymentRequired from body")
                return payment_required
            else:
                logger.warning("Response body does not contain valid PaymentRequired structure")
        except Exception as e:
            logger.error(f"Failed to parse PaymentRequired from body: {e}", exc_info=True)

        return None

    async def _retry_with_payment(
        self,
        method: str,
        url: str,
        payment_payload: PaymentPayload,
        kwargs: dict[str, Any],
    ) -> httpx.Response:
        """Retry request with payment payload"""
        logger.info("Retrying request with payment signature")
        encoded_payload = encode_payment_payload(payment_payload)
        logger.debug(f"Encoded payment payload length: {len(encoded_payload)} chars")

        headers = dict(kwargs.get("headers", {}))
        headers[PAYMENT_SIGNATURE_HEADER] = encoded_payload
        kwargs["headers"] = headers

        response = await self._http_client.request(method, url, **kwargs)
        logger.info(f"Payment retry response: status={response.status_code}")

        if response.status_code >= 400:
            try:
                logger.error(f"Payment retry failed with body: {response.text[:500]}")
            except Exception:
                pass

        return response
