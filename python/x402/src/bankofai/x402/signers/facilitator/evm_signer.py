"""
EvmFacilitatorSigner - EVM facilitator signer implementation

Accepts any wallet object that exposes the agent-wallet BaseWallet interface
(get_address, sign_message, sign_typed_data, sign_transaction).
The signer is agnostic about how the wallet was created (private key, hosted, etc.).
"""

import logging
from typing import Any

from bankofai.x402.signers.facilitator.base import FacilitatorSigner
from bankofai.x402.signers.utils import resolve_provider_uri

logger = logging.getLogger(__name__)


class EvmFacilitatorSigner(FacilitatorSigner):
    """EVM facilitator signer implementation using web3.py"""

    def __init__(self, wallet: Any, address: str) -> None:
        """Create signer from a wallet and its pre-resolved address.

        Prefer the async factory ``create()`` which resolves the address
        automatically.

        Args:
            wallet: Any object implementing the BaseWallet interface
                    (get_address, sign_message, sign_typed_data, sign_transaction).
            address: The wallet's EVM address (checksummed hex).
        """
        self._wallet = wallet
        self._address = address
        self._async_web3_clients: dict[str, Any] = {}
        logger.debug("EvmFacilitatorSigner initialized", extra={"address": self._address})

    @classmethod
    async def create(cls, wallet: Any) -> "EvmFacilitatorSigner":
        """Async factory: resolve address from wallet and create signer."""
        address = await wallet.get_address()
        return cls(wallet, address)

    def get_address(self) -> str:
        return self._address

    def _ensure_async_web3_client(self, network: str) -> Any:
        """Lazy initialize async web3 client for the given network."""
        if network not in self._async_web3_clients:
            from web3 import AsyncHTTPProvider, AsyncWeb3
            from web3.middleware import ExtraDataToPOAMiddleware

            provider_uri = resolve_provider_uri(network)
            w3 = AsyncWeb3(AsyncHTTPProvider(provider_uri))
            w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
            self._async_web3_clients[network] = w3

        return self._async_web3_clients[network]

    async def verify_typed_data(
        self,
        address: str,
        domain: dict[str, Any],
        types: dict[str, Any],
        message: dict[str, Any],
        signature: str,
        primary_type: str,
    ) -> bool:
        """Verify EIP-712 signature (Pure Passthrough)."""
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            typed_data = {
                "types": types,
                "primaryType": primary_type,
                "domain": domain,
                "message": message,
            }

            signable = encode_typed_data(full_message=typed_data)
            sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
            recovered = Account.recover_message(signable, signature=sig_bytes)

            return recovered.lower() == address.lower()
        except Exception as e:
            logger.error("Signature verification failed", extra={"error": str(e)})
            return False

    async def check_balance(
        self,
        token: str,
        network: str,
        address: str | None = None,
    ) -> int:
        """Check ERC20 token balance"""
        w3 = self._ensure_async_web3_client(network)
        if not w3:
            return 0

        from bankofai.x402.abi import ERC20_ABI

        target_address = address or self._address
        try:
            contract = w3.eth.contract(address=token, abi=ERC20_ABI)
            return await contract.functions.balanceOf(target_address).call()
        except Exception as e:
            logger.error(f"Failed to check balance for {target_address}: {e}")
            return 0

    async def write_contract(
        self,
        contract_address: str,
        abi: Any,
        method: str,
        args: list[Any],
        network: str,
    ) -> str | None:
        """Execute contract transaction on EVM (async)."""
        w3 = self._ensure_async_web3_client(network)
        if w3 is None:
            return None

        try:
            import json

            abi_list = json.loads(abi) if isinstance(abi, str) else abi
            contract = w3.eth.contract(address=contract_address, abi=abi_list)
            func = getattr(contract.functions, method)

            tx = await func(*args).build_transaction(
                {
                    "from": self._address,
                    "nonce": await w3.eth.get_transaction_count(self._address),
                    "chainId": await w3.eth.chain_id,
                }
            )

            signed_tx_hex = await self._wallet.sign_transaction(tx)
            tx_hash = await w3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex))
            return tx_hash.hex()
        except Exception as e:
            logger.error(
                "Contract write failed: %s",
                e,
                exc_info=True,
                extra={"method": method, "contract": contract_address},
            )
            return None

    async def wait_for_transaction_receipt(
        self,
        tx_hash: str,
        timeout: int = 120,
        network: str = "",
    ) -> dict[str, Any]:
        """Wait for EVM transaction confirmation"""
        w3 = self._ensure_async_web3_client(network)
        if w3 is None:
            raise RuntimeError("Web3 provider not configured")

        receipt = await w3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)
        return {
            "hash": tx_hash,
            "blockNumber": str(receipt["blockNumber"]),
            "status": "confirmed" if receipt["status"] == 1 else "failed",
            "receipt": receipt,
        }
