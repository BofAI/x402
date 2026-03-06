"""
Wallet interface — abstracts private-key-dependent operations.
"""

from abc import ABC, abstractmethod
from typing import Any


class Wallet(ABC):
    """Minimal wallet interface for signing and address retrieval.

    Implementations may hold a raw private key locally (PrivateKeyWallet)
    or delegate to an external wallet service (AgentWalletAdapter).
    """

    @abstractmethod
    def get_address(self) -> str:
        """Return the wallet's public address (chain-native format)."""

    @abstractmethod
    async def sign_message(self, message: bytes) -> str:
        """Sign an arbitrary message, return signature hex."""

    @abstractmethod
    async def sign_typed_data(self, data: dict[str, Any]) -> str:
        """Sign EIP-712 typed data.

        Args:
            data: Full EIP-712 payload:
                {
                    "types": {"EIP712Domain": [...], ...},
                    "primaryType": "...",
                    "domain": {...},
                    "message": {...},
                }

        Returns:
            Signature hex string.
        """

    @abstractmethod
    async def sign_transaction(self, tx: dict[str, Any]) -> str:
        """Sign a pre-built transaction.
        
        Return format depends on blockchain:
        - EVM: Returns complete signed transaction hex (RLP-encoded) ready for broadcast
        - TRON: Returns signature hex only (to be attached to transaction object)
        
        This difference reflects the underlying blockchain APIs:
        - EVM (web3.py) broadcasts raw signed transactions
        - TRON (tronpy) requires manual signature attachment before broadcast
        """
