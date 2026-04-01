"""TRON mechanism package for x402 Python v2 SDK."""

from .constants import (
    AUTHORIZATION_TYPES,
    EIP2612_PERMIT_TYPES,
    PERMIT2_ADDRESSES,
    PERMIT2_WITNESS_TYPES,
    SCHEME_EXACT,
    TRON_CHAIN_IDS,
    TRON_DEFAULT_ASSETS,
    TRON_NETWORK_CONFIGS,
    X402_PERMIT2_PROXY_ADDRESSES,
    AssetInfo,
    NetworkConfig,
    x402ExactPermit2ProxyABI,
)
from .exact import (
    ExactTronClientScheme,
    ExactTronFacilitatorScheme,
    ExactTronServerScheme,
    register_exact_tron_client,
    register_exact_tron_facilitator,
    register_exact_tron_server,
)
from .signer import ClientTronSigner, FacilitatorTronSigner
from .signers import ClientTronWebSigner, FacilitatorTronWebSigner
from .types import (
    ExactEIP3009Authorization,
    ExactEIP3009Payload,
    ExactPermit2Payload,
    ExactTronPayloadV1,
    ExactTronPayloadV2,
    Permit2Authorization,
    Permit2Witness,
    TypedDataDomain,
    TypedDataField,
    is_permit2_payload,
)
from .utils import (
    create_nonce,
    get_asset_info,
    get_network_config,
    get_tron_chain_id,
    normalize_address_for_signing,
    tron_address_to_evm,
)

__all__ = [
    # Constants
    "TRON_CHAIN_IDS",
    "TRON_DEFAULT_ASSETS",
    "TRON_NETWORK_CONFIGS",
    "AUTHORIZATION_TYPES",
    "EIP2612_PERMIT_TYPES",
    "PERMIT2_WITNESS_TYPES",
    "SCHEME_EXACT",
    "PERMIT2_ADDRESSES",
    "X402_PERMIT2_PROXY_ADDRESSES",
    "x402ExactPermit2ProxyABI",
    "AssetInfo",
    "NetworkConfig",
    # Signers
    "FacilitatorTronSigner",
    "ClientTronSigner",
    "FacilitatorTronWebSigner",
    "ClientTronWebSigner",
    # Utils
    "get_tron_chain_id",
    "get_network_config",
    "get_asset_info",
    "create_nonce",
    "normalize_address_for_signing",
    "tron_address_to_evm",
    # Types
    "ExactEIP3009Authorization",
    "ExactEIP3009Payload",
    "ExactPermit2Payload",
    "ExactTronPayloadV1",
    "ExactTronPayloadV2",
    "Permit2Authorization",
    "Permit2Witness",
    "TypedDataDomain",
    "TypedDataField",
    "is_permit2_payload",
    # Schemes
    "ExactTronClientScheme",
    "ExactTronFacilitatorScheme",
    "ExactTronServerScheme",
    # Register helpers
    "register_exact_tron_client",
    "register_exact_tron_facilitator",
    "register_exact_tron_server",
]
