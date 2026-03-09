"""
FacilitatorClient - Client for communicating with facilitator service
"""

from typing import Any

import httpx

from bankofai.x402_deprecated.types import (
    FeeQuoteResponse,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    SupportedResponse,
    VerifyResponse,
)


class FacilitatorClient:
    """
    Client for communicating with facilitator service.

    Handles verify, settle, fee quote and supported queries.
    """

    def __init__(
        self,
        base_url: str,
        headers: dict[str, str] | None = None,
        facilitator_id: str | None = None,
    ) -> None:
        """
        Initialize facilitator client.

        Args:
            base_url: Facilitator service base URL
            headers: Custom HTTP headers (e.g., Authorization)
            facilitator_id: Unique identifier for this facilitator
        """
        self._base_url = base_url.rstrip("/")
        self._headers = headers or {}
        self.facilitator_id = facilitator_id or base_url
        self._http_client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=self._headers,
                timeout=120.0,
            )
        return self._http_client

    async def close(self) -> None:
        """Close HTTP client"""
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

    async def supported(self) -> SupportedResponse:
        """
        Query facilitator supported capabilities.

        Returns:
            SupportedResponse with supported networks/schemes
        """
        client = await self._get_client()
        response = await client.get("/supported")
        response.raise_for_status()
        return SupportedResponse(**response.json())

    async def fee_quote(
        self,
        accepts: list[PaymentRequirements],
        context: dict[str, Any] | None = None,
    ) -> list[FeeQuoteResponse]:
        """
        Query fee quotes for a list of payment requirements.

        Args:
            accepts: List of payment requirements
            context: Optional payment context

        Returns:
            List of FeeQuoteResponse, one per input requirement
        """
        client = await self._get_client()
        payload: dict[str, Any] = {
            "accepts": [a.model_dump(by_alias=True) for a in accepts],
        }
        if context:
            payload["paymentPermitContext"] = context

        response = await client.post("/fee/quote", json=payload)
        response.raise_for_status()
        return [FeeQuoteResponse(**item) for item in response.json()]

    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        """
        Verify payment signature (without executing on-chain transaction).

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            VerifyResponse
        """
        client = await self._get_client()
        request_body = {
            "paymentPayload": payload.model_dump(by_alias=True),
            "paymentRequirements": requirements.model_dump(by_alias=True),
        }

        response = await client.post("/verify", json=request_body)
        response.raise_for_status()
        return VerifyResponse(**response.json())

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """
        Execute payment settlement (on-chain transaction).

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            SettleResponse with tx_hash
        """
        client = await self._get_client()
        request_body = {
            "paymentPayload": payload.model_dump(by_alias=True),
            "paymentRequirements": requirements.model_dump(by_alias=True),
        }

        response = await client.post("/settle", json=request_body)
        response.raise_for_status()
        return SettleResponse(**response.json())
