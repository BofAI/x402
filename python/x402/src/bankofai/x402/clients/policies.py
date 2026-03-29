"""
Payment policies for filtering or reordering payment requirements.

Policies are applied in order after mechanism filtering and before token selection.
"""

import logging
from typing import TYPE_CHECKING

from bankofai.x402.tokens import TokenRegistry
from bankofai.x402.types import PaymentRequirements

if TYPE_CHECKING:
    from bankofai.x402.clients.x402_client import X402Client

logger = logging.getLogger(__name__)


def _get_decimals(req: PaymentRequirements) -> int:
    """Look up token decimals from the registry, default to 6."""
    token = TokenRegistry.find_by_address(req.network, req.asset)
    return token.decimals if token else 6


class SufficientBalancePolicy:
    """Policy that filters out requirements with insufficient balance.

    When the server accepts multiple tokens (e.g. USDT and USDD),
    this policy checks the balance for each payment option via the
    mechanism's check_balance() and removes requirements the user
    cannot afford.

    Mechanisms are auto-resolved from registered entries via the
    X402Client instance passed at construction time.

    Usage::

        client.register_policy(SufficientBalancePolicy)

    If no mechanism is registered for a requirement's scheme+network,
    that requirement is skipped (excluded from results).

    If all requirements are unaffordable, returns an empty list so the
    caller can raise an appropriate error.
    """

    def __init__(self, client: "X402Client") -> None:
        self._client = client

    async def apply(
        self,
        requirements: list[PaymentRequirements],
    ) -> list[PaymentRequirements]:
        affordable: list[PaymentRequirements] = []
        for req in requirements:
            mechanism = self._client.resolve_mechanism(req.scheme, req.network)
            if mechanism is None:
                continue

            try:
                balance = await mechanism.check_balance(req.asset, req.network)
            except Exception as exc:
                logger.warning(
                    "check_balance() raised for %s on %s; keeping requirement: %s",
                    req.asset,
                    req.network,
                    exc,
                )
                affordable.append(req)
                continue

            needed = int(req.amount)
            if hasattr(req, "extra") and req.extra and hasattr(req.extra, "fee"):
                fee = req.extra.fee
                if fee and hasattr(fee, "fee_amount"):
                    needed += int(fee.fee_amount)
            decimals = _get_decimals(req)
            token_info = TokenRegistry.find_by_address(req.network, req.asset)
            symbol = token_info.symbol if token_info else req.asset[:8]
            divisor = 10**decimals
            h_balance = balance / divisor
            h_needed = needed / divisor
            fmt = f"%.{decimals}f"
            if balance >= needed:
                logger.info(
                    f"%s on %s: balance={fmt} >= needed={fmt} (OK)",
                    symbol,
                    req.network,
                    h_balance,
                    h_needed,
                )
                affordable.append(req)
            else:
                logger.info(
                    f"%s on %s: balance={fmt} < needed={fmt} (skipped)",
                    symbol,
                    req.network,
                    h_balance,
                    h_needed,
                )
        if not affordable:
            logger.error("All payment requirements filtered: insufficient balance")
        return affordable
