"""
X402Facilitator - Core payment processor for x402 protocol
"""

from typing import Any, Protocol

from bankofai.x402.types import (
    FeeQuoteResponse,
    PaymentPayload,
    PaymentRequirements,
    SettleResponse,
    SupportedKind,
    SupportedResponse,
    VerifyResponse,
)


class FacilitatorMechanism(Protocol):
    """Facilitator mechanism interface"""

    def scheme(self) -> str:
        """Get the payment scheme name"""
        ...

    async def fee_quote(
        self,
        accept: PaymentRequirements,
        context: dict[str, Any] | None = None,
    ) -> FeeQuoteResponse | None:
        """Calculate fee quote for a single payment requirement."""
        ...

    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        """Verify payment signature"""
        ...

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """Execute payment settlement"""
        ...


class X402Facilitator:
    """
    Core payment processor for x402 protocol.

    Manages payment mechanisms and coordinates verification/settlement.
    """

    def __init__(self) -> None:
        self._mechanisms: dict[str, dict[str, FacilitatorMechanism]] = {}

    def register(
        self,
        networks: list[str],
        mechanism: FacilitatorMechanism,
    ) -> "X402Facilitator":
        """
        Register a payment mechanism for multiple networks.

        Args:
            networks: List of network identifiers
            mechanism: Facilitator mechanism instance

        Returns:
            self for method chaining
        """
        scheme = mechanism.scheme()
        for network in networks:
            if network not in self._mechanisms:
                self._mechanisms[network] = {}
            self._mechanisms[network][scheme] = mechanism
        return self

    def supported(self, pricing: str = "flat") -> SupportedResponse:
        """
        Return supported network/scheme combinations.

        Args:
            pricing: Fee pricing model, defaults to "flat"

        Returns:
            SupportedResponse with all supported capabilities
        """
        kinds: list[SupportedKind] = []
        for network, schemes in self._mechanisms.items():
            for scheme in schemes:
                kinds.append(
                    SupportedKind(
                        x402Version=2,
                        scheme=scheme,
                        network=network,
                    )
                )

        return SupportedResponse(kinds=kinds)

    async def fee_quote(
        self,
        accepts: list[PaymentRequirements],
        context: dict[str, Any] | None = None,
    ) -> list[FeeQuoteResponse]:
        """
        Calculate fee quotes for a list of payment requirements.

        Unsupported scheme/token combinations are silently skipped,
        so the returned list may be shorter than accepts.

        Args:
            accepts: List of payment requirements
            context: Optional payment context

        Returns:
            List of FeeQuoteResponse for supported requirements only
        """
        results: list[FeeQuoteResponse] = []
        for accept in accepts:
            mechanism = self._find_mechanism(accept.network, accept.scheme)
            if mechanism is None:
                continue
            quote = await mechanism.fee_quote(accept, context)
            if quote is not None:
                results.append(quote)
        return results

    async def verify(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> VerifyResponse:
        """
        Verify payment signature and validity.

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            VerifyResponse
        """
        mechanism = self._find_mechanism(requirements.network, requirements.scheme)
        if mechanism is None:
            return VerifyResponse(
                is_valid=False,
                invalid_reason=(
                    f"unsupported_network_scheme: {requirements.network}/{requirements.scheme}"
                ),
            )
        return await mechanism.verify(payload, requirements)

    async def settle(
        self,
        payload: PaymentPayload,
        requirements: PaymentRequirements,
    ) -> SettleResponse:
        """
        Execute payment settlement.

        Args:
            payload: Payment payload from client
            requirements: Payment requirements

        Returns:
            SettleResponse with tx_hash
        """
        mechanism = self._find_mechanism(requirements.network, requirements.scheme)
        if mechanism is None:
            return SettleResponse(
                success=False,
                error_reason=(
                    f"unsupported_network_scheme: {requirements.network}/{requirements.scheme}"
                ),
            )
        return await mechanism.settle(payload, requirements)

    def _find_mechanism(self, network: str, scheme: str) -> FacilitatorMechanism | None:
        """Find mechanism for network and scheme"""
        network_mechanisms = self._mechanisms.get(network)
        if network_mechanisms is None:
            return None
        return network_mechanisms.get(scheme)
