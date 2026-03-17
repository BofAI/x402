"""x402 Extensions - Optional extensions for the x402 payment protocol.

This module provides optional extensions that enhance the x402 payment protocol
with additional functionality like resource discovery and cataloging.
"""

from .bazaar import (
    BAZAAR,
    BodyDiscoveryExtension,
    BodyDiscoveryInfo,
    BodyInput,
    BodyMethods,
    BodyType,
    DeclareBodyDiscoveryConfig,
    DeclareQueryDiscoveryConfig,
    DiscoveredResource,
    DiscoveryExtension,
    DiscoveryInfo,
    OutputConfig,
    OutputInfo,
    QueryDiscoveryExtension,
    QueryDiscoveryInfo,
    QueryInput,
    QueryParamMethods,
    bazaar_resource_server_extension,
    declare_discovery_extension,
    extract_discovery_info,
    extract_discovery_info_from_extension,
    validate_and_extract,
    validate_discovery_extension,
)
from .bazaar import (
    ValidationResult as BazaarValidationResult,
)

# Create alias for backward compatibility
ValidationResult = BazaarValidationResult

from .eip2612_gas_sponsoring import (  # noqa: E402
    EIP2612_GAS_SPONSORING,
    Eip2612GasSponsoringExtension,
    Eip2612GasSponsoringInfo,
    Eip2612GasSponsoringServerInfo,
    declare_eip2612_gas_sponsoring_extension,
    extract_eip2612_gas_sponsoring_info,
    validate_eip2612_gas_sponsoring_info,
)
from .erc20_approval_gas_sponsoring import (  # noqa: E402
    ERC20_APPROVAL_GAS_SPONSORING,
    ERC20_APPROVAL_GAS_SPONSORING_VERSION,
    Erc20ApprovalGasSponsoringExtension,
    Erc20ApprovalGasSponsoringInfo,
    Erc20ApprovalGasSponsoringServerInfo,
    Erc20ApprovalGasSponsoringSigner,
    create_erc20_approval_gas_sponsoring_extension,
    declare_erc20_approval_gas_sponsoring_extension,
    extract_erc20_approval_gas_sponsoring_info,
    validate_erc20_approval_gas_sponsoring_info,
)
from .payment_identifier import (  # noqa: E402
    PAYMENT_ID_MAX_LENGTH,
    PAYMENT_ID_MIN_LENGTH,
    PAYMENT_ID_PATTERN,
    PAYMENT_IDENTIFIER,
    PaymentIdentifierExtension,
    PaymentIdentifierInfo,
    PaymentIdentifierSchema,
    PaymentIdentifierValidationResult,
    append_payment_identifier_to_extensions,
    declare_payment_identifier_extension,
    extract_and_validate_payment_identifier,
    extract_payment_identifier,
    generate_payment_id,
    has_payment_identifier,
    is_payment_identifier_extension,
    is_payment_identifier_required,
    is_valid_payment_id,
    payment_identifier_resource_server_extension,
    payment_identifier_schema,
    validate_payment_identifier,
    validate_payment_identifier_requirement,
)
from .trc20_approval_gas_sponsoring import (  # noqa: E402
    TRC20_APPROVAL_GAS_SPONSORING,
    TRC20_APPROVAL_GAS_SPONSORING_VERSION,
    Trc20ApprovalGasSponsoringExtension,
    Trc20ApprovalGasSponsoringInfo,
    Trc20ApprovalGasSponsoringServerInfo,
    Trc20ApprovalGasSponsoringSigner,
    create_trc20_approval_gas_sponsoring_extension,
    declare_trc20_approval_gas_sponsoring_extension,
    extract_trc20_approval_gas_sponsoring_info,
    validate_trc20_approval_gas_sponsoring_info,
)

__all__ = [
    # Constants
    "BAZAAR",
    # Method types
    "QueryParamMethods",
    "BodyMethods",
    "BodyType",
    # Input types
    "QueryInput",
    "BodyInput",
    "OutputInfo",
    # Discovery info types
    "QueryDiscoveryInfo",
    "BodyDiscoveryInfo",
    "DiscoveryInfo",
    # Extension types
    "QueryDiscoveryExtension",
    "BodyDiscoveryExtension",
    "DiscoveryExtension",
    # Config types
    "DeclareQueryDiscoveryConfig",
    "DeclareBodyDiscoveryConfig",
    "OutputConfig",
    # Result types
    "ValidationResult",  # From bazaar (for backward compatibility)
    "BazaarValidationResult",  # From bazaar (alias for explicit usage)
    "PaymentIdentifierValidationResult",  # From payment_identifier
    "DiscoveredResource",
    # Server extension
    "bazaar_resource_server_extension",
    # Functions
    "declare_discovery_extension",
    "validate_discovery_extension",
    "extract_discovery_info",
    "extract_discovery_info_from_extension",
    "validate_and_extract",
    # Payment Identifier constants
    "PAYMENT_IDENTIFIER",
    "PAYMENT_ID_MIN_LENGTH",
    "PAYMENT_ID_MAX_LENGTH",
    "PAYMENT_ID_PATTERN",
    # Payment Identifier types
    "PaymentIdentifierInfo",
    "PaymentIdentifierExtension",
    "PaymentIdentifierSchema",
    # Payment Identifier schema
    "payment_identifier_schema",
    # Payment Identifier utils
    "generate_payment_id",
    "is_valid_payment_id",
    # Payment Identifier client functions
    "append_payment_identifier_to_extensions",
    # Payment Identifier server functions
    "declare_payment_identifier_extension",
    "payment_identifier_resource_server_extension",
    # Payment Identifier validation functions
    "is_payment_identifier_extension",
    "validate_payment_identifier",
    "extract_payment_identifier",
    "extract_and_validate_payment_identifier",
    "has_payment_identifier",
    "is_payment_identifier_required",
    "validate_payment_identifier_requirement",
    "PaymentIdentifierValidationResult",
    "BazaarValidationResult",
    # EIP-2612 gas sponsoring
    "EIP2612_GAS_SPONSORING",
    "Eip2612GasSponsoringInfo",
    "Eip2612GasSponsoringServerInfo",
    "Eip2612GasSponsoringExtension",
    "declare_eip2612_gas_sponsoring_extension",
    "extract_eip2612_gas_sponsoring_info",
    "validate_eip2612_gas_sponsoring_info",
    # ERC-20 approval gas sponsoring
    "ERC20_APPROVAL_GAS_SPONSORING",
    "ERC20_APPROVAL_GAS_SPONSORING_VERSION",
    "Erc20ApprovalGasSponsoringSigner",
    "Erc20ApprovalGasSponsoringInfo",
    "Erc20ApprovalGasSponsoringServerInfo",
    "Erc20ApprovalGasSponsoringExtension",
    "create_erc20_approval_gas_sponsoring_extension",
    "declare_erc20_approval_gas_sponsoring_extension",
    "extract_erc20_approval_gas_sponsoring_info",
    "validate_erc20_approval_gas_sponsoring_info",
    # TRC-20 approval gas sponsoring
    "TRC20_APPROVAL_GAS_SPONSORING",
    "TRC20_APPROVAL_GAS_SPONSORING_VERSION",
    "Trc20ApprovalGasSponsoringSigner",
    "Trc20ApprovalGasSponsoringInfo",
    "Trc20ApprovalGasSponsoringServerInfo",
    "Trc20ApprovalGasSponsoringExtension",
    "create_trc20_approval_gas_sponsoring_extension",
    "declare_trc20_approval_gas_sponsoring_extension",
    "extract_trc20_approval_gas_sponsoring_info",
    "validate_trc20_approval_gas_sponsoring_info",
]
