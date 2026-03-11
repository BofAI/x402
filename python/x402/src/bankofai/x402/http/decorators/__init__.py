"""Decorator-based API for x402 payment protection.

Provides a declarative way to protect routes with x402 payment requirements
using Python decorators, as an alternative to the routes dict approach.
"""

from ..types import PaymentOption, RouteConfig

__all__ = [
    "PaymentOption",
    "RouteConfig",
]
