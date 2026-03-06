"""
EvmFacilitatorSigner - EVM facilitator signer implementation
"""

import logging
from typing import Any

from bankofai.x402.abi import PAYMENT_PERMIT_PRIMARY_TYPE
from bankofai.x402.signers.facilitator.base import FacilitatorSigner
from bankofai.x402.signers.utils import _eip712_domain_type_from_keys, resolve_provider_uri
from bankofai.x402.wallet import EvmPrivateKeyWallet, Wallet

logger = logging.getLogger(__name__)


class EvmFacilitatorSigner(FacilitatorSigner):
    """EVM facilitator signer implementation using web3.py"""

    def __init__(self, wallet: Wallet) -> None:
        self._wallet = wallet
        self._address = wallet.get_address()
        self._async_web3_clients: dict[str, Any] = {}
        logger.debug("EvmFacilitatorSigner initialized", extra={"address": self._address})

    @classmethod
    def from_wallet(cls, wallet: Wallet) -> "EvmFacilitatorSigner":
        """Create signer from a Wallet instance."""
        return cls(wallet)

    @classmethod
    def from_private_key(cls, private_key: str) -> "EvmFacilitatorSigner":
        """Create signer from private key (convenience factory)."""
        return cls(EvmPrivateKeyWallet(private_key))

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
    ) -> bool:
        """Verify EIP-712 signature"""
        try:
            from eth_account import Account
            from eth_account.messages import encode_typed_data

            # TODO: Refactor FacilitatorSigner interface to accept primary_type explicitly
            primary_type = (
                PAYMENT_PERMIT_PRIMARY_TYPE
                if PAYMENT_PERMIT_PRIMARY_TYPE in types
                else list(types.keys())[-1]
            )

            # Convert paymentId from hex string to bytes for eth_account compatibility
            message_copy = dict(message)
            if "meta" in message_copy and "paymentId" in message_copy["meta"]:
                payment_id = message_copy["meta"]["paymentId"]
                if isinstance(payment_id, str) and payment_id.startswith("0x"):
                    message_copy["meta"] = dict(message_copy["meta"])
                    message_copy["meta"]["paymentId"] = bytes.fromhex(payment_id[2:])

            # Build EIP712Domain type dynamically from domain keys
            domain_type = _eip712_domain_type_from_keys(domain)

            typed_data = {
                "types": {"EIP712Domain": domain_type, **types},
                "primaryType": primary_type,
                "domain": domain,
                "message": message_copy,
            }

            signable = encode_typed_data(full_message=typed_data)
            sig_bytes = bytes.fromhex(signature[2:] if signature.startswith("0x") else signature)
            recovered = Account.recover_message(signable, signature=sig_bytes)

            return recovered.lower() == address.lower()
        except Exception as e:
            logger.error("Signature verification failed", extra={"error": str(e)})
            return False

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
