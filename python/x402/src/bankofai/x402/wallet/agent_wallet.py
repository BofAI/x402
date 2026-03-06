"""
AgentWalletAdapter — Adapts agent-wallet's BaseWallet to x402 Wallet interface.
"""

import json
from typing import Any

from bankofai.x402.wallet.base import Wallet


class AgentWalletAdapter(Wallet):
    """Adapter that wraps an agent-wallet BaseWallet instance.

    Usage:
        from agent_wallet import WalletFactory
        provider = WalletFactory(secrets_dir="~/.agent-wallet", password="...")
        agent_wallet = await provider.get_wallet("my-wallet")
        wallet = await AgentWalletAdapter.create(agent_wallet)
        signer = EvmClientSigner.from_wallet(wallet)
    """

    def __init__(self, agent_wallet: Any, address: str) -> None:
        """Use AgentWalletAdapter.create() instead of calling this directly."""
        self._agent_wallet = agent_wallet
        self._address = address

    @classmethod
    async def create(cls, agent_wallet: Any) -> "AgentWalletAdapter":
        """Create adapter by eagerly resolving the async address."""
        address = await agent_wallet.get_address()
        return cls(agent_wallet, address)

    def get_address(self) -> str:
        return self._address

    async def sign_message(self, message: bytes) -> str:
        return await self._agent_wallet.sign_message(message)

    async def sign_typed_data(self, data: dict[str, Any]) -> str:
        return await self._agent_wallet.sign_typed_data(data)

    async def sign_transaction(self, tx: dict[str, Any]) -> str:
        """Sign transaction and return result.
        
        Return format depends on blockchain:
        - EVM: Returns complete signed transaction hex (RLP-encoded)
        - TRON: Returns signature hex only
        
        agent-wallet's TRON adapter returns a JSON string with the full signed transaction,
        so we parse it and extract only the signature to match PrivateKeyWallet behavior.
        agent-wallet's EVM adapter already returns the raw transaction hex directly.
        """
        result = await self._agent_wallet.sign_transaction(tx)
        
        # TRON case: agent-wallet returns JSON, extract signature
        if isinstance(result, str) and result.strip().startswith("{"):
            signed_obj = json.loads(result)
            signatures = signed_obj.get("signature") or []
            if not signatures:
                raise ValueError("agent-wallet returned signed tx JSON without signature")
            return signatures[0]
        
        # EVM case: agent-wallet returns raw transaction hex directly
        return result
