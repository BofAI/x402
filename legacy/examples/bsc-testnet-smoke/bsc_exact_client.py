#!/usr/bin/env python3
"""
Minimal BSC testnet exact client example using a local private key.
"""

import asyncio
import os

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from bankofai.x402.clients import SufficientBalancePolicy, X402Client, X402HttpClient
from bankofai.x402.config import NetworkConfig
from bankofai.x402.mechanisms.evm.exact import ExactEvmClientMechanism
from bankofai.x402.mechanisms.evm.exact_permit import ExactPermitEvmClientMechanism
from bankofai.x402.signers.client import EvmClientSigner


class LocalEvmWallet:
    def __init__(self, private_key: str) -> None:
        key = private_key if private_key.startswith("0x") else f"0x{private_key}"
        self._account = Account.from_key(key)

    async def get_address(self) -> str:
        return self._account.address

    async def sign_message(self, message: bytes) -> str:
        signed = self._account.sign_message(encode_defunct(primitive=message))
        return "0x" + signed.signature.hex()

    async def sign_typed_data(self, full_data: dict) -> str:
        signed = Account.sign_message(
            encode_typed_data(full_message=full_data),
            private_key=self._account.key,
        )
        return "0x" + signed.signature.hex()

    async def sign_transaction(self, tx: dict) -> str:
        signed = self._account.sign_transaction(tx)
        raw_tx = signed.raw_transaction.hex()
        return raw_tx[2:] if raw_tx.startswith("0x") else raw_tx


async def main() -> None:
    private_key = os.environ["BSC_CLIENT_PRIVATE_KEY"]
    server_url = os.getenv("SERVER_URL", "http://127.0.0.1:8012")
    endpoint = os.getenv("ENDPOINT", "/protected-bsc-testnet-coinbase")

    signer_wallet = LocalEvmWallet(private_key)
    signer = EvmClientSigner(signer_wallet)
    signer.set_address(await signer_wallet.get_address())

    x402 = X402Client()
    x402.register(NetworkConfig.BSC_TESTNET, ExactPermitEvmClientMechanism(signer))
    x402.register(NetworkConfig.BSC_TESTNET, ExactEvmClientMechanism(signer))
    x402.register_policy(SufficientBalancePolicy)

    async with httpx.AsyncClient(timeout=120) as http_client:
        client = X402HttpClient(http_client, x402)
        response = await client.get(f"{server_url}{endpoint}")
        print(response.status_code)
        print(response.text[:500])


if __name__ == "__main__":
    asyncio.run(main())
