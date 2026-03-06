"""
EvmPrivateKeyWallet — EVM wallet backed by a local private key.
"""

from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from bankofai.x402.wallet.base import Wallet


class EvmPrivateKeyWallet(Wallet):
    """EVM wallet using a local private key (eth-account)."""

    def __init__(self, private_key: str) -> None:
        if not private_key.startswith("0x"):
            private_key = "0x" + private_key
        self._private_key = private_key
        self._address = Account.from_key(private_key).address

    def get_address(self) -> str:
        return self._address

    async def sign_message(self, message: bytes) -> str:
        signable = encode_defunct(primitive=message)
        signed = Account.sign_message(signable, private_key=self._private_key)
        return signed.signature.hex()

    async def sign_typed_data(self, data: dict[str, Any]) -> str:
        signable = encode_typed_data(full_message=data)
        signed = Account.sign_message(signable, private_key=self._private_key)
        return signed.signature.hex()

    async def sign_transaction(self, tx: dict[str, Any]) -> str:
        signed = Account.sign_transaction(tx, private_key=self._private_key)
        return signed.raw_transaction.hex()
