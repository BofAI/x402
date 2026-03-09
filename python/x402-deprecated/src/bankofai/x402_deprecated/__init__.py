"""
x402 - Payment Protocol SDK for Python

Supports Client, Server, and Facilitator functionality for multi-chain payments.
"""

import warnings

warnings.warn(
    "bankofai.x402_deprecated is deprecated. Use bankofai.x402 (the coinbase-based SDK) instead.",
    DeprecationWarning,
    stacklevel=2,
)

__version__ = "0.1.0"

from bankofai.x402_deprecated.address import (
    AddressConverter,
    EvmAddressConverter,
    TronAddressConverter,
)
from bankofai.x402_deprecated.exceptions import (
    AllowanceCheckError,
    AllowanceError,
    ConfigurationError,
    InsufficientAllowanceError,
    PermitValidationError,
    SettlementError,
    SignatureCreationError,
    SignatureError,
    SignatureVerificationError,
    TransactionError,
    TransactionFailedError,
    TransactionTimeoutError,
    UnknownTokenError,
    UnsupportedNetworkError,
    ValidationError,
    X402Error,
)
from bankofai.x402_deprecated.tokens import TokenInfo, TokenRegistry
from bankofai.x402_deprecated.types import (
    PaymentPayload,
    PaymentPermit,
    PaymentRequired,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)

__all__ = [
    "__version__",
    # Types
    "PaymentPermit",
    "PaymentPayload",
    "PaymentRequirements",
    "PaymentRequired",
    "VerifyResponse",
    "SettleResponse",
    # Exceptions
    "X402Error",
    "SignatureError",
    "SignatureVerificationError",
    "SignatureCreationError",
    "AllowanceError",
    "InsufficientAllowanceError",
    "AllowanceCheckError",
    "SettlementError",
    "TransactionError",
    "TransactionFailedError",
    "TransactionTimeoutError",
    "ValidationError",
    "PermitValidationError",
    "ConfigurationError",
    "UnsupportedNetworkError",
    "UnknownTokenError",
    # Address converters
    "AddressConverter",
    "EvmAddressConverter",
    "TronAddressConverter",
    # Token registry
    "TokenInfo",
    "TokenRegistry",
]
