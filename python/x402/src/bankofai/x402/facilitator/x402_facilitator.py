"""
X402Facilitator - Core payment processor for x402 protocol
"""

import logging
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
from bankofai.x402.utils.address import checksum_evm_address


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
        self._logger = logging.getLogger(self.__class__.__name__)

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

    def supported(self) -> SupportedResponse:
        """
        Return supported network/scheme combinations.

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
            try:
                accept = self._normalize_evm_requirements(accept)
            except ValueError as exc:
                raise ValueError(
                    f"Invalid payment requirements for {accept.network}/{accept.scheme}: {exc}"
                ) from exc
            mechanism = self._find_mechanism(accept.network, accept.scheme)
            if mechanism is None:
                continue
            try:
                quote = await mechanism.fee_quote(accept, context)
                if quote is not None:
                    results.append(quote)
            except Exception as exc:
                raise RuntimeError(
                    f"Fee quote failed for {accept.network}/{accept.scheme}: {exc}"
                ) from exc
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
        try:
            requirements = self._normalize_evm_requirements(requirements)
        except ValueError as exc:
            return VerifyResponse(is_valid=False, invalid_reason=str(exc))
        try:
            return await mechanism.verify(payload, requirements)
        except Exception as exc:
            self._logger.error(
                "verify failed: %s",
                exc,
                exc_info=True,
                extra={"network": requirements.network, "scheme": requirements.scheme},
            )
            return VerifyResponse(
                is_valid=False,
                invalid_reason=str(exc),
            )

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
                network=requirements.network,
                error_reason=(
                    f"unsupported_network_scheme: {requirements.network}/{requirements.scheme}"
                ),
            )
        try:
            requirements = self._normalize_evm_requirements(requirements)
        except ValueError as exc:
            return SettleResponse(
                success=False,
                network=requirements.network,
                error_reason=str(exc),
            )
        try:
            return await mechanism.settle(payload, requirements)
        except Exception as exc:
            self._logger.error(
                "settle failed: %s",
                exc,
                exc_info=True,
                extra={"network": requirements.network, "scheme": requirements.scheme},
            )
            return SettleResponse(
                success=False,
                network=requirements.network,
                error_reason=str(exc),
            )

    def _find_mechanism(self, network: str, scheme: str) -> FacilitatorMechanism | None:
        """Find mechanism for network and scheme"""
        network_mechanisms = self._mechanisms.get(network)
        if network_mechanisms is None:
            return None
        return network_mechanisms.get(scheme)

    @staticmethod
    def _normalize_evm_requirements(
        requirements: PaymentRequirements,
    ) -> PaymentRequirements:
        if not requirements.network.startswith("eip155:"):
            return requirements

        requirements.asset = checksum_evm_address(requirements.asset, strict=True)
        requirements.pay_to = checksum_evm_address(requirements.pay_to, strict=True)

        if requirements.extra and requirements.extra.fee:
            requirements.extra.fee.fee_to = checksum_evm_address(
                requirements.extra.fee.fee_to, strict=True
            )
            if requirements.extra.fee.caller:
                requirements.extra.fee.caller = checksum_evm_address(
                    requirements.extra.fee.caller, strict=True
                )

        return requirements
