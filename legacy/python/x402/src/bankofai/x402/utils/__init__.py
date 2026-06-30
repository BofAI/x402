"""
X402 Utility Functions
"""

from bankofai.x402.utils.address import normalize_tron_address, tron_address_to_evm
from bankofai.x402.utils.eip712 import (
    EVM_ZERO_ADDRESS,
    TRON_ZERO_ADDRESS,
    convert_permit_to_eip712_message,
    convert_tron_addresses_to_evm,
    payment_id_to_bytes,
)
from bankofai.x402.utils.payment_id import generate_payment_id
from bankofai.x402.utils.tron_verification import TronTransactionVerifier
from bankofai.x402.utils.tx_verification import (
    BaseTransactionVerifier,
    TransactionVerificationResult,
    TransactionVerifier,
    TransferEvent,
    get_verifier_for_network,
)

__all__ = [
    "normalize_tron_address",
    "tron_address_to_evm",
    "generate_payment_id",
    "EVM_ZERO_ADDRESS",
    "TRON_ZERO_ADDRESS",
    "payment_id_to_bytes",
    "convert_permit_to_eip712_message",
    "convert_tron_addresses_to_evm",
    # Transaction verification
    "TransferEvent",
    "TransactionVerificationResult",
    "TransactionVerifier",
    "BaseTransactionVerifier",
    "TronTransactionVerifier",
    "get_verifier_for_network",
]
