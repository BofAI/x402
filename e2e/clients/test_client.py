"""
Test client for e2e scenarios.

Sends one GET to a protected endpoint, handles the 402→retry flow via
`X402HttpClient`, and writes the terminal response as JSON so scenarios can
compare with an expected shape.

Configuration (all env vars):

    E2E_CLIENT_PRIVATE_KEY   hex private key (default Anvil #0)
    E2E_SERVER_URL           base URL of the resource server (default http://127.0.0.1:4021)
    E2E_ENDPOINT             path to request (default /protected)
    E2E_NETWORK              payer network identifier (default eip155:97)
    E2E_SCHEMES              comma-separated schemes to register (default "exact_permit,exact")
    E2E_OUTPUT               output JSON path (default /tmp/x402-e2e-response.json)
    E2E_TIMEOUT_SECONDS      total HTTP timeout (default 30)
    E2E_SKIP_ALLOWANCE       "1" to bypass on-chain ERC20 allowance checks (needed for
                             `exact_permit` scenarios driven by the mock facilitator,
                             where no live chain RPC is reachable)
    E2E_GASFREE_API_URL      base URL of the GasFree API (default http://127.0.0.1:4020 —
                             the mock facilitator serves both roles)
    E2E_TRON_PRIVATE_KEY     hex TRON private key (default: deterministic test key)

Exit codes:
    0   request completed (any HTTP status — the scenario decides pass/fail by diff)
    2   harness/config error
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct, encode_typed_data

from bankofai.x402.clients import X402Client, X402HttpClient
from bankofai.x402.signers.client import EvmClientSigner, TronClientSigner

ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Deterministic test TRON key — all-ones, trivially guessable.
# SAFE FOR LOCAL / MOCK E2E ONLY. Never use on mainnet or any real-value network;
# the derived address is publicly known and its funds can be swept instantly.
TRON_TEST_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111"


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
        raw = signed.raw_transaction.hex()
        return raw[2:] if raw.startswith("0x") else raw


class _AllowanceSkippingEvmSigner(EvmClientSigner):
    """EvmClientSigner variant that short-circuits allowance checks.

    Used by e2e scenarios that run against the mock facilitator — real
    web3 RPC is unreachable, and the mock does not verify allowance anyway.
    """

    async def check_allowance(self, token: str, amount: int, network: str) -> int:
        return 2**256 - 1

    async def ensure_allowance(
        self, token: str, amount: int, network: str, mode: str = "auto"
    ) -> bool:
        return True


class LocalTronWallet:
    """TRON wallet backed by a local private key.

    TRON uses the same secp256k1 + keccak256 crypto as Ethereum for TIP-712,
    so we can reuse `eth_account` for typed-data signing. The only TRON-specific
    step is deriving the base58check address from the public key.
    """

    def __init__(self, private_key: str) -> None:
        from tronpy.keys import PrivateKey

        key_hex = private_key[2:] if private_key.startswith("0x") else private_key
        self._tron_key = PrivateKey(bytes.fromhex(key_hex))
        self._eth_account = Account.from_key("0x" + key_hex)

    async def get_address(self) -> str:
        return self._tron_key.public_key.to_base58check_address()

    async def sign_message(self, message: bytes) -> str:
        signed = self._eth_account.sign_message(encode_defunct(primitive=message))
        return signed.signature.hex()

    async def sign_typed_data(self, full_data: dict) -> str:
        signed = Account.sign_message(
            encode_typed_data(full_message=full_data),
            private_key=self._eth_account.key,
        )
        return signed.signature.hex()

    async def sign_transaction(self, tx: dict) -> str:
        raise NotImplementedError("TRON raw tx signing is not used by e2e scenarios")


def _build_tron_signer(wallet: "LocalTronWallet") -> Any:
    """Build a TronClientSigner that bypasses chain RPC.

    Both `check_balance` and `check_allowance` normally hit a TronGrid node; in
    the e2e harness there is no such node, and the mock facilitator does not
    verify balances anyway. We override both to keep the signer fully offline.
    """
    class _OfflineTronSigner(TronClientSigner):
        async def check_balance(self, token: str, network: str, address: str | None = None) -> int:
            return 2**256 - 1

        async def check_allowance(self, token: str, amount: int, network: str) -> int:
            return 2**256 - 1

        async def ensure_allowance(
            self, token: str, amount: int, network: str, mode: str = "auto"
        ) -> bool:
            return True

    return _OfflineTronSigner(wallet)


def _schemes() -> list[str]:
    raw = os.environ.get("E2E_SCHEMES", "exact_permit,exact")
    return [s.strip() for s in raw.split(",") if s.strip()]


def _register_client_mechanisms(
    x402: X402Client,
    network: str,
    schemes: list[str],
    signer: EvmClientSigner | TronClientSigner,
) -> None:
    for scheme in schemes:
        if scheme == "exact":
            if not network.startswith("eip155:"):
                raise SystemExit(
                    f"scheme 'exact' (ERC-3009) requires eip155:* network, got {network}"
                )
            from bankofai.x402.mechanisms.evm.exact import ExactEvmClientMechanism

            x402.register(network, ExactEvmClientMechanism(signer))
        elif scheme == "exact_permit":
            if network.startswith("eip155:"):
                from bankofai.x402.mechanisms.evm.exact_permit import (
                    ExactPermitEvmClientMechanism,
                )

                x402.register(network, ExactPermitEvmClientMechanism(signer))
            elif network.startswith("tron:"):
                from bankofai.x402.mechanisms.tron.exact_permit import (
                    ExactPermitTronClientMechanism,
                )

                x402.register(network, ExactPermitTronClientMechanism(signer))
            else:
                raise SystemExit(f"unknown network prefix: {network}")
        elif scheme == "exact_gasfree":
            from bankofai.x402.mechanisms.tron.exact_gasfree.client import (
                ExactGasFreeClientMechanism,
            )
            from bankofai.x402.utils.gasfree import GasFreeAPIClient

            api_url = os.environ.get("E2E_GASFREE_API_URL", "http://127.0.0.1:4020")
            clients = {network: GasFreeAPIClient(api_url)}
            x402.register(network, ExactGasFreeClientMechanism(signer, clients=clients))
        else:
            raise SystemExit(f"unknown scheme: {scheme}")


def _coerce_response_payload(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (list, tuple)):
        return [_coerce_response_payload(v) for v in value]
    if isinstance(value, dict):
        return {k: _coerce_response_payload(v) for k, v in value.items()}
    return str(value)


async def run() -> int:
    server_url = os.environ.get("E2E_SERVER_URL", "http://127.0.0.1:4021").rstrip("/")
    endpoint = os.environ.get("E2E_ENDPOINT", "/protected")
    network = os.environ.get("E2E_NETWORK", "eip155:97")
    schemes = _schemes()
    output_path = os.environ.get("E2E_OUTPUT", "/tmp/x402-e2e-response.json")
    timeout = float(os.environ.get("E2E_TIMEOUT_SECONDS", "30"))

    if network.startswith("tron:"):
        private_key = os.environ.get("E2E_TRON_PRIVATE_KEY", TRON_TEST_KEY)
        wallet = LocalTronWallet(private_key)
        signer = _build_tron_signer(wallet)
    else:
        private_key = os.environ.get("E2E_CLIENT_PRIVATE_KEY", ANVIL_KEY_0)
        wallet = LocalEvmWallet(private_key)
        signer_cls = (
            _AllowanceSkippingEvmSigner
            if os.environ.get("E2E_SKIP_ALLOWANCE") == "1"
            else EvmClientSigner
        )
        signer = signer_cls(wallet)
    signer.set_address(await wallet.get_address())

    x402 = X402Client()
    _register_client_mechanisms(x402, network, schemes, signer)

    async with httpx.AsyncClient(timeout=timeout) as http_client:
        client = X402HttpClient(http_client, x402)
        response = await client.get(f"{server_url}{endpoint}")

        try:
            body_json: Any = response.json()
        except ValueError:
            body_json = response.text

        payment_response_header = response.headers.get(
            "PAYMENT-RESPONSE"
        ) or response.headers.get("payment-response")

        payment_response: Any = None
        if payment_response_header:
            try:
                import base64

                decoded = base64.b64decode(payment_response_header).decode("utf-8")
                payment_response = json.loads(decoded)
            except (ValueError, json.JSONDecodeError):
                payment_response = payment_response_header

        result = {
            "status_code": response.status_code,
            "body": _coerce_response_payload(body_json),
            "payment_response": payment_response,
        }

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, sort_keys=True)
        f.write("\n")
    return 0


def main() -> int:
    try:
        return asyncio.run(run())
    except Exception as exc:
        print(f"e2e client error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
