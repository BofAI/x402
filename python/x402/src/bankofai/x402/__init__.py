"""
x402 - Payment Protocol SDK for Python

Supports Client, Server, and Facilitator functionality for multi-chain payments.
"""

from bankofai.x402.address import (
    AddressConverter,
    EvmAddressConverter,
    TronAddressConverter,
)
from bankofai.x402.exceptions import (
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
from bankofai.x402.tokens import TokenInfo, TokenRegistry
from bankofai.x402.types import (
    PaymentPayload,
    PaymentPermit,
    PaymentRequired,
    PaymentRequirements,
    SettleResponse,
    VerifyResponse,
)

__version__ = "0.5.3"
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
