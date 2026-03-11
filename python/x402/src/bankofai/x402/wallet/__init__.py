"""
Wallet abstraction layer for x402 signers.

Provides a Wallet interface that encapsulates private-key-dependent operations
(signing, address derivation), decoupling signers from raw key management.
"""

from bankofai.x402.wallet.agent_wallet import AgentWalletAdapter
from bankofai.x402.wallet.base import Wallet
from bankofai.x402.wallet.evm import EvmPrivateKeyWallet
from bankofai.x402.wallet.tron import TronPrivateKeyWallet

__all__ = [
    "Wallet",
    "EvmPrivateKeyWallet",
    "TronPrivateKeyWallet",
    "AgentWalletAdapter",
]
