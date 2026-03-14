"""BSC Testnet permit2 MCP integration tests with real blockchain settlement."""

import asyncio
import os
import socket
import threading
import time

import pytest

mcp = pytest.importorskip("mcp", reason="mcp package not available")
from mcp import ClientSession  # noqa: E402
from mcp.client.streamable_http import streamable_http_client  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402
from mcp.types import TextContent  # noqa: E402

from bankofai.x402 import x402ClientSync, x402FacilitatorSync, x402ResourceServerSync  # noqa: E402
from bankofai.x402.mcp import create_payment_wrapper, x402MCPClientSync  # noqa: E402
from bankofai.x402.mechanisms.evm.exact import (  # noqa: E402
    ExactEvmClientScheme,
    ExactEvmFacilitatorScheme,
    ExactEvmSchemeConfig,
    ExactEvmServerScheme,
)
from bankofai.x402.mechanisms.evm.signers import (  # noqa: E402
    EthAccountSigner,
    FacilitatorWeb3Signer,
)
from bankofai.x402.schemas import ResourceConfig, ResourceInfo  # noqa: E402

BSC_CLIENT_PRIVATE_KEY = os.environ.get("BSC_CLIENT_PRIVATE_KEY")
BSC_FACILITATOR_PRIVATE_KEY = os.environ.get("BSC_FACILITATOR_PRIVATE_KEY")
BSC_RPC_URL = os.environ.get("BSC_TESTNET_RPC_URL")

TEST_NETWORK = "eip155:97"
TEST_PORT_PAID = 4101

pytestmark = pytest.mark.skipif(
    not BSC_CLIENT_PRIVATE_KEY or not BSC_FACILITATOR_PRIVATE_KEY or not BSC_RPC_URL,
    reason=(
        "BSC_CLIENT_PRIVATE_KEY, BSC_FACILITATOR_PRIVATE_KEY, and "
        "BSC_TESTNET_RPC_URL are required for MCP BSC permit2 integration tests"
    ),
)


class EvmFacilitatorClientSync:
    """Facilitator client wrapper for x402ResourceServerSync."""

    scheme = "exact"
    network = TEST_NETWORK
    x402_version = 2

    def __init__(self, facilitator: x402FacilitatorSync):
        self._facilitator = facilitator

    def verify(self, payload, requirements):
        return self._facilitator.verify(payload, requirements)

    def settle(self, payload, requirements):
        return self._facilitator.settle(payload, requirements)

    def get_supported(self):
        return self._facilitator.get_supported()


class MCPClientAdapter:
    """Adapter that wraps mcp.ClientSession to x402.mcp.MCPClientInterface."""

    def __init__(self, session: ClientSession):
        self._session = session

    def connect(self, transport):
        pass

    def close(self):
        pass

    def call_tool(self, params, **kwargs):
        import nest_asyncio

        nest_asyncio.apply()

        name = params.get("name", "")
        arguments = params.get("arguments", {})
        meta = None
        if "_meta" in params:
            meta = params["_meta"]
        elif "_meta" in kwargs:
            meta = kwargs["_meta"]
        elif "meta" in kwargs:
            meta = kwargs["meta"]

        if meta is not None:
            result = asyncio.run(self._session.call_tool(name, arguments, meta=meta))
        else:
            result = asyncio.run(self._session.call_tool(name, arguments))

        content = []
        for item in result.content:
            if isinstance(item, TextContent):
                content.append({"type": "text", "text": item.text})
            else:
                content.append({"type": getattr(item, "type", "text"), "text": str(item)})

        return type(
            "MCPResult",
            (),
            {
                "content": content,
                "isError": result.isError,
                "_meta": result.meta if hasattr(result, "meta") and result.meta else {},
                "structuredContent": (
                    result.structuredContent if hasattr(result, "structuredContent") else None
                ),
            },
        )()

    def list_tools(self):
        import nest_asyncio

        nest_asyncio.apply()

        result = asyncio.run(self._session.list_tools())
        tools = []
        for tool in result.tools:
            tools.append({"name": tool.name, "description": tool.description})
        return {"tools": tools}


class TestMCPBscPermit2Integration:
    """MCP integration coverage for BSC permit2."""

    def setup_method(self):
        from eth_account import Account

        client_account = Account.from_key(BSC_CLIENT_PRIVATE_KEY)
        self.client_signer = EthAccountSigner(client_account)
        self.facilitator_signer = FacilitatorWeb3Signer(
            private_key=BSC_FACILITATOR_PRIVATE_KEY,
            rpc_url=BSC_RPC_URL,
        )

        self.client = x402ClientSync().register(
            TEST_NETWORK,
            ExactEvmClientScheme(self.client_signer),
        )
        self.facilitator = x402FacilitatorSync().register(
            [TEST_NETWORK],
            ExactEvmFacilitatorScheme(
                self.facilitator_signer,
                ExactEvmSchemeConfig(deploy_erc4337_with_eip6492=True),
            ),
        )

        facilitator_client = EvmFacilitatorClientSync(self.facilitator)
        self.server = x402ResourceServerSync(facilitator_client)
        self.server.register(TEST_NETWORK, ExactEvmServerScheme())
        self.server.initialize()

    def test_paid_tool_with_real_bsc_permit2_transaction(self):
        """Run the MCP auto-payment flow against BSC Testnet permit2."""
        config = ResourceConfig(
            scheme="exact",
            network=TEST_NETWORK,
            pay_to=self.facilitator_signer.address,
            price="$0.0001",
        )
        accepts = self.server.build_payment_requirements(config)
        assert accepts[0].extra["assetTransferMethod"] == "permit2"

        weather_wrapper = create_payment_wrapper(
            self.server,
            accepts=accepts,
            resource=ResourceInfo(
                url="mcp://tool/get_weather",
                description="Get weather for a city",
                mime_type="application/json",
            ),
        )

        mcp_server = FastMCP("x402-test-server-bsc", json_response=True, port=TEST_PORT_PAID)

        @mcp_server.tool(
            name="get_weather",
            description="Get weather for a city. Requires payment of $0.0001.",
        )
        @weather_wrapper
        async def get_weather(city: str) -> str:
            return '{"city": "' + city + '", "weather": "sunny", "temperature": 72}'

        server_thread = threading.Thread(
            target=lambda: mcp_server.run(transport="streamable-http"),
            daemon=True,
        )
        server_thread.start()

        max_wait = 5.0
        start_time = time.time()
        while time.time() - start_time < max_wait:
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.settimeout(0.1)
                result = sock.connect_ex(("localhost", TEST_PORT_PAID))
                sock.close()
                if result == 0:
                    break
            except Exception:
                pass
            time.sleep(0.1)
        else:
            raise RuntimeError(
                f"Server failed to start on port {TEST_PORT_PAID} within {max_wait}s"
            )

        try:

            async def run_client():
                async with streamable_http_client(f"http://localhost:{TEST_PORT_PAID}/mcp") as (
                    read_stream,
                    write_stream,
                    _,
                ):
                    async with ClientSession(read_stream, write_stream) as session:
                        await session.initialize()

                        adapter = MCPClientAdapter(session)
                        x402_mcp = x402MCPClientSync(
                            adapter,
                            self.client,
                            auto_payment=True,
                            on_payment_requested=lambda ctx: True,
                        )

                        result = x402_mcp.call_tool("get_weather", {"city": "Shanghai"})

                        assert result.payment_made is True
                        assert result.is_error is False
                        assert result.payment_response is not None
                        assert result.payment_response.success is True
                        assert result.payment_response.transaction.startswith("0x")
                        assert result.payment_response.network == TEST_NETWORK

            asyncio.run(run_client())
        finally:
            pass
