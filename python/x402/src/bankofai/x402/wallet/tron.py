"""
TronPrivateKeyWallet — TRON wallet backed by a local private key.
"""

from typing import Any

from Crypto.Hash import SHA256
from eth_account import Account
from eth_account.messages import encode_typed_data
from tronpy.keys import PrivateKey

from bankofai.x402.wallet.base import Wallet


class TronPrivateKeyWallet(Wallet):
    """TRON wallet using a local private key (tronpy + eth-account)."""

    def __init__(self, private_key: str) -> None:
        clean_key = private_key[2:] if private_key.startswith("0x") else private_key
        self._private_key = clean_key
        self._address = self._derive_address(clean_key)

    @staticmethod
    def _derive_address(private_key: str) -> str:
        pk = PrivateKey(bytes.fromhex(private_key))
        return pk.public_key.to_base58check_address()

    def get_address(self) -> str:
        return self._address

    async def sign_message(self, message: bytes) -> str:
        pk = PrivateKey(bytes.fromhex(self._private_key))
        signature = pk.sign_msg(message)
        return signature.hex()

    async def sign_typed_data(self, data: dict[str, Any]) -> str:
        signable = encode_typed_data(full_message=data)
        private_key_bytes = bytes.fromhex(self._private_key)
        signed = Account.sign_message(signable, private_key_bytes)
        return signed.signature.hex()

    async def sign_transaction(self, tx: dict[str, Any]) -> str:
        tx_id_hex = tx.get("txID") or tx.get("txid")
        if tx_id_hex is None:
            raw_data_hex = tx.get("raw_data_hex") or tx.get("raw_dataHex")
            if raw_data_hex is None:
                raise ValueError(
                    "Payload must be an unsigned TRON transaction JSON containing txID/txid or raw_data_hex"
                )
            raw_data_bytes = bytes.fromhex(raw_data_hex)
            tx_id_hex = SHA256.new(raw_data_bytes).hexdigest()

        tx_id_bytes = bytes.fromhex(tx_id_hex)
        pk = PrivateKey(bytes.fromhex(self._private_key))
        signature = pk.sign_msg_hash(tx_id_bytes)
        return signature.hex()
