"""
TronClientSigner - TRON client signer implementation

Accepts any wallet object that exposes the agent-wallet BaseWallet interface
(get_address, sign_message, sign_typed_data, sign_transaction).
The signer is agnostic about how the wallet was created (private key, hosted, etc.).
"""

import json as json_module
import logging
from typing import Any

from bankofai.x402.abi import ERC20_ABI
from bankofai.x402.config import NetworkConfig
from bankofai.x402.exceptions import InsufficientAllowanceError, SignatureCreationError
from bankofai.x402.signers.client.base import ClientSigner

logger = logging.getLogger(__name__)


class TronClientSigner(ClientSigner):
    """TRON client signer implementation"""

    def __init__(self, wallet: Any) -> None:
        """Create signer from a wallet.

        Prefer the async factory ``create()`` or ``from_private_key()``.

        Args:
            wallet: Any object implementing the BaseWallet interface
                    (get_address, sign_message, sign_typed_data, sign_transaction).
        """
        self._wallet = wallet
        self._address: str | None = None
        self._async_tron_clients: dict[str, Any] = {}
        logger.debug("TronClientSigner initialized")

    @classmethod
    async def create(cls) -> "TronClientSigner":
        """Async factory: resolve active agent wallet and create signer."""
        from agent_wallet import resolve_wallet_provider

        provider = resolve_wallet_provider(network="tron")
        wallet = await provider.get_active_wallet()
        signer = cls(wallet)
        signer.set_address(await wallet.get_address())
        return signer

    @classmethod
    async def from_private_key(cls, private_key: str) -> "TronClientSigner":
        """Create signer from a raw private-key hex string (backward-compat).

        Uses agent-wallet's ``create_wallet_provider`` internally.
        """
        from agent_wallet import PrivateKeyProviderOptions, create_wallet_provider

        provider = create_wallet_provider(
            PrivateKeyProviderOptions(private_key=private_key, network="tron")
        )
        wallet = await provider.get_active_wallet()
        signer = cls(wallet)
        signer.set_address(await wallet.get_address())
        return signer

    @staticmethod
    def _extract_tron_signature(result: str) -> str:
        """Extract signature hex from agent-wallet's sign_transaction result.

        agent-wallet's TronWallet returns a JSON string with the full signed
        transaction.  We extract the first signature entry.
        """
        if isinstance(result, str) and result.strip().startswith("{"):
            signed = json_module.loads(result)
            sigs = signed.get("signature", [])
            if not sigs:
                raise ValueError("Wallet returned signed tx without signature")
            result = sigs[0]
        return result

    def _ensure_async_tron_client(self, network: str) -> Any:
        """Lazy initialize async tron_client for the given network.

        Args:
            network: Network identifier (e.g. 'tron:nile', 'tron:mainnet').

        Returns:
            tronpy.AsyncTron instance or None
        """
        if network not in self._async_tron_clients:
            try:
                from bankofai.x402.utils.tron_client import create_async_tron_client

                self._async_tron_clients[network] = create_async_tron_client(network)
            except ImportError:
                return None
        return self._async_tron_clients[network]

    def get_address(self) -> str:
        if not self._address:
            raise ValueError("Signer address has not been initialized")
        return self._address

    def set_address(self, address: str) -> None:
        self._address = address

    async def sign_message(self, message: bytes) -> str:
        """Sign raw message using ECDSA"""
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
        logger.info(
            f"Signing EIP-712 typed data: domain={domain.get('name')}, primaryType={primary_type}"
        )
        try:
            typed_data = {
                "types": types,
                "primaryType": primary_type,
                "domain": domain,
                "message": message,
            }

            # Log domain and message in same format as TypeScript client
            import json as json_module

            # Convert bytes to hex for logging
            message_for_log = dict(message)
            if "meta" in message_for_log and "paymentId" in message_for_log["meta"]:
                pid = message_for_log["meta"]["paymentId"]
                if isinstance(pid, bytes):
                    message_for_log["meta"] = dict(message_for_log["meta"])
                    message_for_log["meta"]["paymentId"] = "0x" + pid.hex()

            logger.info(f"[SIGN] Domain: {json_module.dumps(domain)}")
            logger.info(f"[SIGN] Message: {json_module.dumps(message_for_log)}")

            signature = await self._wallet.sign_typed_data(typed_data)
            logger.info(f"[SIGN] Signature: 0x{signature}")
            return signature
        except Exception as e:
            raise SignatureCreationError(f"Failed to sign typed data: {e}")

    async def check_balance(
        self,
        token: str,
        network: str,
        address: str | None = None,
    ) -> int:
        """Check TRC20 token balance"""
        client = self._ensure_async_tron_client(network)
        if client is None:
            logger.warning("AsyncTron client not available, returning 0 balance")
            return 0

        target_address = address or self.get_address()
        try:
            contract = await client.get_contract(token)
            contract.abi = ERC20_ABI
            balance = await contract.functions.balanceOf(target_address)
            balance_int = int(balance)
            from bankofai.x402.tokens import TokenRegistry

            token_info = TokenRegistry.find_by_address(network, token)
            decimals = token_info.decimals if token_info else 6
            symbol = token_info.symbol if token_info else token[:8]
            human = balance_int / (10**decimals)
            logger.info(
                f"Token balance for {target_address}: {human:.6f} {symbol} "
                f"(raw={balance_int}, token={token}, network={network})"
            )
            return balance_int
        except Exception as e:
            logger.error(f"Failed to check balance for {target_address}: {e}")
            return 0

    async def check_allowance(
        self,
        token: str,
        amount: int,
        network: str,
    ) -> int:
        """Check token allowance on TRON"""
        spender = self._get_spender_address(network)
        address = self.get_address()
        logger.info(
            "Checking allowance: token=%s, owner=%s, spender=%s, network=%s",
            token,
            address,
            spender,
            network,
        )
        if not spender or spender == "T0000000000000000000000000000000":
            logger.warning(
                f"Invalid spender address for network {network}, skipping allowance check"
            )
            return 0

        client = self._ensure_async_tron_client(network)
        if client is None:
            logger.warning("AsyncTron client not available, returning 0 allowance")
            return 0

        try:
            contract = await client.get_contract(token)
            contract.abi = ERC20_ABI
            allowance = await contract.functions.allowance(
                address,
                spender,
            )
            allowance_int = int(allowance)
            logger.info(f"Current allowance: {allowance_int}")
            return allowance_int
        except Exception as e:
            logger.error(f"Failed to check allowance: {e}")
            return 0

    async def ensure_allowance(
        self,
        token: str,
        amount: int,
        network: str,
        mode: str = "auto",
    ) -> bool:
        """Ensure sufficient allowance"""
        logger.info(
            f"Ensuring allowance: token={token}, amount={amount}, network={network}, mode={mode}"
        )
        if mode == "skip":
            logger.info("Skipping allowance check (mode=skip)")
            return True

        current = await self.check_allowance(token, amount, network)
        if current >= amount:
            logger.info(f"Sufficient allowance already exists: {current} >= {amount}")
            return True

        if mode == "interactive":
            raise NotImplementedError("Interactive approval not implemented")

        logger.info(f"Insufficient allowance ({current} < {amount}), requesting approval...")
        client = self._ensure_async_tron_client(network)
        if client is None:
            raise InsufficientAllowanceError("AsyncTron client required for approval")

        try:
            spender = self._get_spender_address(network)
            # Use maxUint160 (2^160 - 1) to avoid repeated approvals
            max_uint160 = (2**160) - 1
            logger.info(f"Approving spender={spender} for amount={max_uint160} (maxUint160)")
            contract = await client.get_contract(token)
            contract.abi = ERC20_ABI
            # AsyncTron: contract.functions.approve() returns a coroutine, need to await it first
            txn_builder = await contract.functions.approve(spender, max_uint160)
            owner_address = self.get_address()
            txn_builder = txn_builder.with_owner(owner_address).fee_limit(100_000_000)
            txn = await txn_builder.build()
            # Sign the transaction via wallet
            txn_dict = txn.to_json()
            raw_result = await self._wallet.sign_transaction(txn_dict)
            sig_hex = self._extract_tron_signature(raw_result)
            txn._signature = [sig_hex]
            logger.info("Broadcasting approval transaction...")
            result = await txn.broadcast()
            result = await result.wait()
            # Check receipt.result for success (TRON returns "SUCCESS" in receipt)
            receipt = result.get("receipt", {})
            receipt_result = receipt.get("result", "")
            success = receipt_result == "SUCCESS"
            if success:
                logger.info(f"Approval successful: txid={result.get('id')}")
            else:
                logger.warning(f"Approval failed: {result}")
            return success
        except Exception as e:
            raise InsufficientAllowanceError(f"Approval transaction failed: {e}") from e

    def _get_spender_address(self, network: str) -> str:
        """Get payment permit contract address (spender)"""
        return NetworkConfig.get_payment_permit_address(network)
