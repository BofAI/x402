"""
Token selection strategies for choosing which token to pay with.

When a server accepts multiple tokens, the client needs a strategy to pick one.
All tokens are assumed to be stablecoins, so selection normalizes raw amounts
by token decimals to compare real value (lower is better for the payer).
"""

import logging
from decimal import Decimal
from typing import Protocol, runtime_checkable

from bankofai.x402.tokens import TokenRegistry
from bankofai.x402.types import PaymentRequirements

logger = logging.getLogger(__name__)


@runtime_checkable
class TokenSelectionStrategy(Protocol):
    """Strategy for selecting which payment option to use.

    Implementations receive the list of accepted payment requirements
    (already filtered to those the client has a mechanism for)
    and return the best one.
    """

    async def select(
        self,
        accepts: list[PaymentRequirements],
    ) -> PaymentRequirements:
        """Select the best payment requirement from available options.

        Args:
            accepts: Available payment requirements.

        Returns:
            The selected PaymentRequirements.

        Raises:
            ValueError: If no suitable option is found.
        """
        ...


def _get_decimals(req: PaymentRequirements) -> int:
    """Look up token decimals from the registry, default to 6."""
    token = TokenRegistry.find_by_address(req.network, req.asset)
    return token.decimals if token else 6


def _normalized_cost(req: PaymentRequirements) -> Decimal:
    """Calculate total cost normalized to human-readable units.

    e.g. 1_000_000 raw with 6 decimals  -> 1.0
         1_000_000_000_000_000_000 raw with 18 decimals -> 1.0
    """
    decimals = _get_decimals(req)
    return Decimal(str(req.amount)) / Decimal(10) ** decimals


class CheapestTokenSelectionStrategy:
    """Default strategy: normalize by token decimals, pick cheapest.

    Compares real value (amount / 10^decimals) so that tokens with
    different precisions (e.g. USDT 6, USDD 18) are ranked fairly.
    """

    async def select(
        self,
        accepts: list[PaymentRequirements],
    ) -> PaymentRequirements:
        if not accepts:
            raise ValueError("No payment options available")

        selected = min(accepts, key=_normalized_cost)
        logger.info(
            "Selected token %s on %s (normalized_cost=%.6f)",
            selected.asset,
            selected.network,
            _normalized_cost(selected),
        )
        return selected


DefaultTokenSelectionStrategy = CheapestTokenSelectionStrategy
