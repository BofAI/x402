"""
EvmClientSigner - EVM client signer implementation

Accepts any wallet object that exposes the agent-wallet Wallet interface
(get_address, sign_message, sign_typed_data, sign_transaction).
The signer is agnostic about how the wallet was created (private key, hosted, etc.).
"""

import logging
from typing import Any

from bankofai.x402.abi import ERC20_ABI
from bankofai.x402.config import NetworkConfig
from bankofai.x402.exceptions import InsufficientAllowanceError, SignatureCreationError
from bankofai.x402.signers.client.base import ClientSigner
from bankofai.x402.signers.utils import resolve_provider_uri
from bankofai.x402.utils.address import checksum_evm_address

logger = logging.getLogger(__name__)


class EvmClientSigner(ClientSigner):
    """EVM client signer implementation using web3.py"""

    def __init__(self, wallet: Any) -> None:
        """Create signer from a wallet.

        Prefer the async factory ``create()``.

        Args:
            wallet: Any object implementing the Wallet interface
                    (get_address, sign_message, sign_typed_data, sign_transaction).
        """
        self._wallet = wallet
        self._address: str | None = None
        self._async_web3_clients: dict[str, Any] = {}
        logger.debug("EvmClientSigner initialized")

    @classmethod
    async def create(cls) -> "EvmClientSigner":
        """Async factory: resolve active agent wallet and create signer."""
        from agent_wallet import resolve_wallet_provider

        provider = resolve_wallet_provider(network="eip155")
        wallet = await provider.get_active_wallet()
        signer = cls(wallet)
        signer.set_address(await wallet.get_address())
        return signer

    def get_address(self) -> str:
        if not self._address:
            raise ValueError("Signer address has not been initialized")
        return self._address

    def set_address(self, address: str) -> None:
        self._address = address

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

    async def sign_message(self, message: bytes) -> str:
        """Sign raw message using ECDSA (EIP-191)"""
        try:
            return await self._wallet.sign_message(message)
        except Exception as e:
            raise SignatureCreationError(f"Failed to sign message: {e}")

    async def sign_typed_data(
        self,
        domain: dict[str, Any],
        types: dict[str, Any],
        message: dict[str, Any],
        primary_type: str,
    ) -> str:
        """Sign EIP-712 typed data (Pure Passthrough)."""
        try:
            full_data = {
                "types": types,
                "domain": domain,
                "primaryType": primary_type,
                "message": message,
            }

            return await self._wallet.sign_typed_data(full_data)
        except Exception as e:
            raise SignatureCreationError(f"Failed to sign typed data: {e}")

    async def check_balance(self, token: str, network: str, address: str | None = None) -> int:
        """Check ERC20 token balance"""
        try:
            w3 = self._ensure_async_web3_client(network)
            if not w3:
                return 0

            target_address = checksum_evm_address(address or self._address)
            token_address = checksum_evm_address(token)
            contract = w3.eth.contract(address=token_address, abi=ERC20_ABI)
            return await contract.functions.balanceOf(target_address).call()
        except (ImportError, ModuleNotFoundError):
            logger.warning("web3 not available, returning 0 balance")
            return 0
        except Exception as e:
            logger.error("Failed to check ERC20 balance: %s", e)
            raise

    async def check_allowance(self, token: str, amount: int, network: str) -> int:
        """Check ERC20 allowance"""
        try:
            spender = checksum_evm_address(self._get_spender_address(network))
            w3 = self._ensure_async_web3_client(network)
            if not spender or not w3:
                return 0

            token_address = checksum_evm_address(token)
            owner_address = checksum_evm_address(self._address)
            contract = w3.eth.contract(address=token_address, abi=ERC20_ABI)
            return await contract.functions.allowance(owner_address, spender).call()
        except (ImportError, ModuleNotFoundError):
            logger.warning("web3 not available, returning 0 allowance")
            return 0
        except Exception as e:
            logger.error("Failed to check ERC20 allowance: %s", e)
            raise

    async def ensure_allowance(
        self,
        token: str,
        amount: int,
        network: str,
        mode: str = "auto",
    ) -> bool:
        """Ensure allowance is sufficient for the spender"""
        if mode == "skip":
            return True

        current = await self.check_allowance(token, amount, network)
        if current >= amount:
            return True

        if mode == "interactive":
            raise InsufficientAllowanceError("Interactive approval required")

        try:
            w3 = self._ensure_async_web3_client(network)
            if not w3:
                raise InsufficientAllowanceError("Web3 provider not configured")

            spender = checksum_evm_address(self._get_spender_address(network))
            token_address = checksum_evm_address(token)
            from_address = checksum_evm_address(self._address)
            contract = w3.eth.contract(address=token_address, abi=ERC20_ABI)

            tx = await contract.functions.approve(spender, 2**256 - 1).build_transaction(
                {
                    "from": from_address,
                    "nonce": await w3.eth.get_transaction_count(from_address),
                    "chainId": await w3.eth.chain_id,
                }
            )

            signed_tx_hex = await self._wallet.sign_transaction(tx)
            tx_hash = await w3.eth.send_raw_transaction(bytes.fromhex(signed_tx_hex))
            receipt = await w3.eth.wait_for_transaction_receipt(tx_hash)

            success = receipt.status == 1
            if success:
                logger.info(
                    "ERC20 approval successful",
                    extra={"token": token, "tx_hash": tx_hash.hex()},
                )
            return success
        except (ImportError, ModuleNotFoundError):
            raise InsufficientAllowanceError("web3 not available for approval")
        except Exception as e:
            raise InsufficientAllowanceError(f"ERC20 approval transaction failed: {e}")

    def _get_spender_address(self, network: str) -> str:
        """Get payment permit contract address (spender)"""
        return NetworkConfig.get_payment_permit_address(network)
