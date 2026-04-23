"""
Example facilitator HTTP server.

Wraps `bankofai.x402.facilitator.X402Facilitator` with a FastAPI binding that
matches the HTTP wire format `FacilitatorClient` expects:

    GET  /supported       → SupportedResponse
    POST /fee/quote       → list[FeeQuoteResponse]
    POST /verify          → VerifyResponse
    POST /settle          → SettleResponse

Chains are registered based on which env vars are present. A facilitator
private key is required for any scheme that settles on-chain.

Configuration (all env vars):

    FACILITATOR_HOST              bind host (default 127.0.0.1)
    FACILITATOR_PORT              bind port (default 8013)
    FACILITATOR_LOG_LEVEL         uvicorn log level (default info)

    --- EVM (enabled when FACILITATOR_EVM_PRIVATE_KEY is set) ---
    FACILITATOR_EVM_PRIVATE_KEY   0x-prefixed hex private key for settlement
    FACILITATOR_EVM_NETWORKS      comma-separated CAIP-2 list (default "eip155:97")
    FACILITATOR_EVM_SCHEMES       comma-separated, subset of "exact,exact_permit"
                                  (default "exact,exact_permit")
    {NETWORK}_RPC_URL             override RPC per network, e.g.
                                  BSC_TESTNET_RPC_URL for eip155:97

    --- TRON (enabled when FACILITATOR_TRON_PRIVATE_KEY is set) ---
    FACILITATOR_TRON_PRIVATE_KEY  0x-prefixed hex private key for settlement
    FACILITATOR_TRON_NETWORKS     comma-separated, e.g. "tron:nile" (default "tron:nile")
    FACILITATOR_TRON_SCHEMES      comma-separated, subset of "exact_permit,exact_gasfree"
                                  (default "exact_permit,exact_gasfree")
    GASFREE_API_URL               base URL for GasFree API (required when
                                  exact_gasfree is in TRON_SCHEMES)

Run: `python -m examples.facilitator`
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from bankofai.x402.facilitator import X402Facilitator
from bankofai.x402.types import (
    PaymentPayload,
    PaymentRequirements,
)


def _env_list(name: str, default: str) -> list[str]:
    raw = os.environ.get(name, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


def _build_evm_wallet(private_key: str) -> Any:
    from eth_account import Account
    from eth_account.messages import encode_defunct, encode_typed_data

    key = private_key if private_key.startswith("0x") else f"0x{private_key}"
    account = Account.from_key(key)

    class _LocalEvmWallet:
        async def get_address(self) -> str:
            return account.address

        async def sign_message(self, message: bytes) -> str:
            signed = account.sign_message(encode_defunct(primitive=message))
            return "0x" + signed.signature.hex()

        async def sign_typed_data(self, full_data: dict) -> str:
            signed = Account.sign_message(
                encode_typed_data(full_message=full_data),
                private_key=account.key,
            )
            return "0x" + signed.signature.hex()

        async def sign_transaction(self, tx: dict) -> str:
            signed = account.sign_transaction(tx)
            raw = signed.raw_transaction.hex()
            return raw[2:] if raw.startswith("0x") else raw

    return _LocalEvmWallet()


def _build_tron_wallet(private_key: str) -> Any:
    from eth_account import Account
    from eth_account.messages import encode_defunct, encode_typed_data
    from tronpy.keys import PrivateKey

    key_hex = private_key[2:] if private_key.startswith("0x") else private_key
    tron_key = PrivateKey(bytes.fromhex(key_hex))
    eth_account = Account.from_key("0x" + key_hex)

    class _LocalTronWallet:
        async def get_address(self) -> str:
            return tron_key.public_key.to_base58check_address()

        async def sign_message(self, message: bytes) -> str:
            signed = eth_account.sign_message(encode_defunct(primitive=message))
            return signed.signature.hex()

        async def sign_typed_data(self, full_data: dict) -> str:
            signed = Account.sign_message(
                encode_typed_data(full_message=full_data),
                private_key=eth_account.key,
            )
            return signed.signature.hex()

        async def sign_transaction(self, tx: dict) -> str:
            raise NotImplementedError("raw TRON tx signing not used by facilitator")

    return _LocalTronWallet()


def _register_evm(facilitator: X402Facilitator, logger: logging.Logger) -> None:
    private_key = os.environ.get("FACILITATOR_EVM_PRIVATE_KEY")
    if not private_key:
        logger.info("EVM facilitator disabled (FACILITATOR_EVM_PRIVATE_KEY not set)")
        return

    from bankofai.x402.signers.facilitator import EvmFacilitatorSigner

    networks = _env_list("FACILITATOR_EVM_NETWORKS", "eip155:97")
    schemes = _env_list("FACILITATOR_EVM_SCHEMES", "exact,exact_permit")

    from eth_account import Account

    key = private_key if private_key.startswith("0x") else f"0x{private_key}"
    wallet = _build_evm_wallet(private_key)
    signer = EvmFacilitatorSigner(wallet)
    signer.set_address(Account.from_key(key).address)

    for scheme in schemes:
        if scheme == "exact":
            from bankofai.x402.mechanisms.evm.exact.facilitator import (
                ExactEvmFacilitatorMechanism,
            )

            facilitator.register(networks, ExactEvmFacilitatorMechanism(signer))
        elif scheme == "exact_permit":
            from bankofai.x402.mechanisms.evm.exact_permit.facilitator import (
                ExactPermitEvmFacilitatorMechanism,
            )

            facilitator.register(networks, ExactPermitEvmFacilitatorMechanism(signer))
        else:
            logger.warning("skipping unknown EVM scheme: %s", scheme)
            continue
        logger.info("registered EVM scheme=%s networks=%s", scheme, networks)


def _register_tron(facilitator: X402Facilitator, logger: logging.Logger) -> None:
    private_key = os.environ.get("FACILITATOR_TRON_PRIVATE_KEY")
    if not private_key:
        logger.info("TRON facilitator disabled (FACILITATOR_TRON_PRIVATE_KEY not set)")
        return

    from bankofai.x402.signers.facilitator import TronFacilitatorSigner

    networks = _env_list("FACILITATOR_TRON_NETWORKS", "tron:nile")
    schemes = _env_list("FACILITATOR_TRON_SCHEMES", "exact_permit,exact_gasfree")

    from tronpy.keys import PrivateKey

    key_hex = private_key[2:] if private_key.startswith("0x") else private_key
    wallet = _build_tron_wallet(private_key)
    signer = TronFacilitatorSigner(wallet)
    tron_address = PrivateKey(bytes.fromhex(key_hex)).public_key.to_base58check_address()
    signer.set_address(tron_address)

    for scheme in schemes:
        if scheme == "exact_permit":
            from bankofai.x402.mechanisms.tron.exact_permit.facilitator import (
                ExactPermitTronFacilitatorMechanism,
            )

            facilitator.register(networks, ExactPermitTronFacilitatorMechanism(signer))
        elif scheme == "exact_gasfree":
            from bankofai.x402.mechanisms.tron.exact_gasfree.facilitator import (
                ExactGasFreeFacilitatorMechanism,
            )
            from bankofai.x402.utils.gasfree import GasFreeAPIClient

            api_url = os.environ.get("GASFREE_API_URL")
            if not api_url:
                logger.warning(
                    "exact_gasfree requested but GASFREE_API_URL is not set — skipping"
                )
                continue
            clients = {network: GasFreeAPIClient(api_url) for network in networks}
            facilitator.register(
                networks, ExactGasFreeFacilitatorMechanism(signer, clients=clients)
            )
        else:
            logger.warning("skipping unknown TRON scheme: %s", scheme)
            continue
        logger.info("registered TRON scheme=%s networks=%s", scheme, networks)


def build_app() -> FastAPI:
    logger = logging.getLogger("x402.example_facilitator")
    logger.setLevel(logging.INFO)

    facilitator = X402Facilitator()
    _register_evm(facilitator, logger)
    _register_tron(facilitator, logger)

    supported = facilitator.supported()
    if not supported.kinds:
        logger.warning(
            "no mechanisms registered — check FACILITATOR_*_PRIVATE_KEY env vars"
        )
    else:
        logger.info(
            "facilitator ready, supported kinds: %s",
            [f"{k.scheme}@{k.network}" for k in supported.kinds],
        )

    app = FastAPI(title="x402 example facilitator")

    @app.get("/supported")
    async def _supported() -> JSONResponse:
        return JSONResponse(facilitator.supported().model_dump(by_alias=True))

    @app.post("/fee/quote")
    async def _fee_quote(body: dict[str, Any]) -> JSONResponse:
        accepts = [PaymentRequirements(**item) for item in body.get("accepts", [])]
        context = body.get("paymentPermitContext")
        quotes = await facilitator.fee_quote(accepts, context=context)
        return JSONResponse([q.model_dump(by_alias=True) for q in quotes])

    @app.post("/verify")
    async def _verify(body: dict[str, Any]) -> JSONResponse:
        payload = PaymentPayload(**body["paymentPayload"])
        requirements = PaymentRequirements(**body["paymentRequirements"])
        resp = await facilitator.verify(payload, requirements)
        return JSONResponse(resp.model_dump(by_alias=True))

    @app.post("/settle")
    async def _settle(body: dict[str, Any]) -> JSONResponse:
        payload = PaymentPayload(**body["paymentPayload"])
        requirements = PaymentRequirements(**body["paymentRequirements"])
        resp = await facilitator.settle(payload, requirements)
        return JSONResponse(resp.model_dump(by_alias=True))

    return app


app = build_app()


def main() -> int:
    try:
        import uvicorn
    except ImportError:
        print("uvicorn is required; install with `pip install uvicorn`", file=sys.stderr)
        return 2

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    host = os.environ.get("FACILITATOR_HOST", "127.0.0.1")
    port = int(os.environ.get("FACILITATOR_PORT", "8013"))
    log_level = os.environ.get("FACILITATOR_LOG_LEVEL", "info")

    uvicorn.run(
        "examples.facilitator.server:app",
        host=host,
        port=port,
        log_level=log_level,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
