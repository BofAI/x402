"""
x402 Mechanisms - Payment mechanisms for different chains

Structure:
    _base/                  - ABC interfaces (ClientMechanism, ...)
    _exact_permit_base/     - Shared base classes for "exact_permit" scheme
    _exact_base/            - Shared base classes for "exact" scheme
    evm/                    - EVM chain implementations
        exact_permit/       - exact_permit scheme (client, facilitator, server)
        exact/              - exact scheme (adapter, client, facilitator, server)
    tron/                   - TRON chain implementations
        exact_permit/       - exact_permit scheme (client, facilitator, server)
        exact/              - exact scheme (adapter, client, facilitator, server)
"""

from bankofai.x402.mechanisms import evm, tron
from bankofai.x402.mechanisms._base import ClientMechanism, FacilitatorMechanism, ServerMechanism
from bankofai.x402.mechanisms._exact_base import (
    ChainAdapter,
    ExactBaseClientMechanism,
    ExactBaseFacilitatorMechanism,
    ExactBaseServerMechanism,
)
from bankofai.x402.mechanisms._exact_permit_base import (
    BaseExactPermitClientMechanism,
    BaseExactPermitFacilitatorMechanism,
    BaseExactPermitServerMechanism,
)
from bankofai.x402.mechanisms.evm import (
    ExactEvmClientMechanism,
    ExactEvmFacilitatorMechanism,
    ExactEvmServerMechanism,
    ExactPermitEvmClientMechanism,
    ExactPermitEvmFacilitatorMechanism,
    ExactPermitEvmServerMechanism,
)
from bankofai.x402.mechanisms.tron import (
    ExactPermitTronClientMechanism,
    ExactPermitTronFacilitatorMechanism,
    ExactPermitTronServerMechanism,
    ExactTronClientMechanism,
    ExactTronFacilitatorMechanism,
    ExactTronServerMechanism,
)

__all__ = [
    # Base interfaces
    "ClientMechanism",
    "FacilitatorMechanism",
    "ServerMechanism",
    # ExactPermit base
    "BaseExactPermitClientMechanism",
    "BaseExactPermitFacilitatorMechanism",
    "BaseExactPermitServerMechanism",
    # Exact base
    "ChainAdapter",
    "ExactBaseClientMechanism",
    "ExactBaseFacilitatorMechanism",
    "ExactBaseServerMechanism",
    # EVM
    "ExactPermitEvmClientMechanism",
    "ExactPermitEvmFacilitatorMechanism",
    "ExactPermitEvmServerMechanism",
    "ExactEvmClientMechanism",
    "ExactEvmFacilitatorMechanism",
    "ExactEvmServerMechanism",
    # TRON
    "ExactPermitTronClientMechanism",
    "ExactPermitTronFacilitatorMechanism",
    "ExactPermitTronServerMechanism",
    "ExactTronClientMechanism",
    "ExactTronFacilitatorMechanism",
    "ExactTronServerMechanism",
    # Subpackages
    "evm",
    "tron",
]
