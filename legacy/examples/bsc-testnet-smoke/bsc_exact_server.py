"""
Minimal FastAPI server that advertises BSC testnet exact_permit and exact.

Use an ERC-3009-compatible token for the exact route. On BSC testnet this example
uses DHLU, matching the smoke-tested interoperability path.
"""

from fastapi import FastAPI

from bankofai.x402.config import NetworkConfig
from bankofai.x402.facilitator import FacilitatorClient
from bankofai.x402.fastapi import x402_protected
from bankofai.x402.mechanisms.evm.exact import ExactEvmServerMechanism
from bankofai.x402.mechanisms.evm.exact_permit import ExactPermitEvmServerMechanism
from bankofai.x402.server import X402Server

app = FastAPI()

server = X402Server()
server.register(NetworkConfig.BSC_TESTNET, ExactPermitEvmServerMechanism())
server.register(NetworkConfig.BSC_TESTNET, ExactEvmServerMechanism())
server.set_facilitator(FacilitatorClient("http://127.0.0.1:8013"))


@app.get("/protected-bsc-testnet")
@x402_protected(
    server=server,
    prices=["0.0001 USDT", "0.0001 DHLU"],
    schemes=["exact_permit", "exact"],
    network=NetworkConfig.BSC_TESTNET,
    pay_to="0x6d361463Ad6Df90bC34aF65f4970d3271aa83535",
)
async def protected_bsc_testnet() -> dict[str, object]:
    return {"ok": True, "network": NetworkConfig.BSC_TESTNET}


@app.get("/protected-bsc-testnet-coinbase")
@x402_protected(
    server=server,
    prices=["0.0001 DHLU"],
    schemes=["exact"],
    network=NetworkConfig.BSC_TESTNET,
    pay_to="0x6d361463Ad6Df90bC34aF65f4970d3271aa83535",
)
async def protected_bsc_testnet_coinbase() -> dict[str, object]:
    return {
        "ok": True,
        "impl": "bankofai-example-server",
        "network": NetworkConfig.BSC_TESTNET,
    }
