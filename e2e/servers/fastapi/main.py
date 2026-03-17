"""FastAPI e2e test server using x402 v2 SDK."""

import os
import signal
import sys
import asyncio
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

# Import from new x402 package
from bankofai.x402 import x402ResourceServer
from bankofai.x402.http import FacilitatorConfig, HTTPFacilitatorClient
from bankofai.x402.http.middleware.fastapi import payment_middleware
from bankofai.x402.mechanisms.evm.exact import (
    register_exact_evm_server,
)
from bankofai.x402.mechanisms.svm.exact import register_exact_svm_server
from bankofai.x402.mechanisms.tron.exact import register_exact_tron_server
from bankofai.x402.extensions.bazaar import (
    bazaar_resource_server_extension,
    declare_discovery_extension,
    OutputConfig,
)
from bankofai.x402.extensions.trc20_approval_gas_sponsoring import (
    declare_trc20_approval_gas_sponsoring_extension,
)

# Load environment variables
load_dotenv()

# Get configuration from environment
EVM_ADDRESS = os.getenv("EVM_PAYEE_ADDRESS")
EVM_FACILITATOR_ADDRESS = os.getenv("EVM_FACILITATOR_ADDRESS")
SVM_ADDRESS = os.getenv("SVM_PAYEE_ADDRESS")
TRON_ADDRESS = os.getenv("TRON_PAYEE_ADDRESS")
TRON_FACILITATOR_ADDRESS = os.getenv("TRON_FACILITATOR_ADDRESS")
PORT = int(os.getenv("PORT", "4021"))
FACILITATOR_URL = os.getenv("FACILITATOR_URL")

if not EVM_ADDRESS:
    print("Error: Missing required environment variable EVM_PAYEE_ADDRESS")
    sys.exit(1)

if not SVM_ADDRESS:
    print("Warning: SVM_PAYEE_ADDRESS not set - SVM payment endpoints disabled")
if not TRON_ADDRESS:
    print("Warning: TRON_PAYEE_ADDRESS not set - TRON payment endpoints disabled")
if not TRON_FACILITATOR_ADDRESS:
    print("Warning: TRON_FACILITATOR_ADDRESS not set - TRON Permit2 endpoints disabled")
if not EVM_FACILITATOR_ADDRESS:
    print("Warning: EVM_FACILITATOR_ADDRESS not set - EVM Permit2 witness will default to payTo")

# Network configurations (CAIP-2 format)
EVM_NETWORK = "eip155:97"  # BSC Testnet
SVM_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"  # Solana Devnet
TRON_NETWORK = os.getenv("TRON_NETWORK") or "tron:nile"

app = FastAPI()

# Create HTTP facilitator client
if FACILITATOR_URL:
    print(f"Using remote facilitator at: {FACILITATOR_URL}")
    config = FacilitatorConfig(url=FACILITATOR_URL)
    facilitator = HTTPFacilitatorClient(config)
else:
    print("Using default facilitator")
    facilitator = HTTPFacilitatorClient()

# Create resource server
server = x402ResourceServer(facilitator)

# Register DHLU token for BSC Testnet
server.asset_registry.register(
    EVM_NETWORK,
    "DHLU",
    {
        "address": "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
        "decimals": 6,
        "name": "DA HULU",
        "version": "1",
        "supports_eip2612": True,
    },
)

# Register EVM exact scheme (always) and SVM exact scheme (if configured)
register_exact_evm_server(server, EVM_NETWORK)
if SVM_ADDRESS:
    register_exact_svm_server(server, SVM_NETWORK)
if TRON_ADDRESS:
    register_exact_tron_server(server, TRON_NETWORK)

# Register Bazaar discovery extension
server.register_extension(bazaar_resource_server_extension)

# Define routes with payment requirements
routes = {
    "GET /protected": {
        "accepts": {
            "scheme": "exact",
            "payTo": EVM_ADDRESS,
            "assets": ["DHLU"],
            "price": {
                "amount": "1000",
                "asset": "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
                "extra": {"name": "DA HULU", "version": "1"},
            },
            "network": EVM_NETWORK,
        },
        "extensions": {
            **declare_discovery_extension(
                output=OutputConfig(
                    example={
                        "message": "Access granted to protected resource",
                        "timestamp": "2024-01-01T00:00:00Z",
                    },
                    schema={
                        "properties": {
                            "message": {"type": "string"},
                            "timestamp": {"type": "string"},
                        },
                        "required": ["message", "timestamp"],
                    },
                )
            ),
        },
    },
    "GET /protected-2": {
        "accepts": {
            "scheme": "exact",
            "payTo": EVM_ADDRESS,
            "assets": ["DHLU"],
            "price": {
                "amount": "1000",
                "asset": "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
                "extra": {"name": "DA HULU", "version": "1"},
            },
            "network": EVM_NETWORK,
        },
        "extensions": {
            **declare_discovery_extension(
                output=OutputConfig(
                    example={
                        "message": "Access granted to protected resource #2",
                        "timestamp": "2024-01-01T00:00:00Z",
                    },
                    schema={
                        "properties": {
                            "message": {"type": "string"},
                            "timestamp": {"type": "string"},
                        },
                        "required": ["message", "timestamp"],
                    },
                )
            ),
        },
    },
    "GET /protected-permit2": {
        "accepts": {
            "scheme": "exact",
            "payTo": EVM_ADDRESS,
            "assets": ["DHLU"],
            "price": {
                "amount": "1000",
                "asset": "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816",
                "extra": {
                    "name": "DA HULU",
                    "version": "1",
                    "assetTransferMethod": "permit2",
                    **(
                        {"permit2FacilitatorAddress": EVM_FACILITATOR_ADDRESS}
                        if EVM_FACILITATOR_ADDRESS
                        else {}
                    ),
                },
            },
            "network": EVM_NETWORK,
        },
        "extensions": {
            **declare_discovery_extension(
                output=OutputConfig(
                    example={
                        "message": "Access granted to Permit2 protected resource",
                        "timestamp": "2024-01-01T00:00:00Z",
                    },
                    schema={
                        "properties": {
                            "message": {"type": "string"},
                            "timestamp": {"type": "string"},
                        },
                        "required": ["message", "timestamp"],
                    },
                )
            ),
        },
    },
    **(
        {
            "GET /protected-svm": {
                "accepts": {
                    "scheme": "exact",
                    "payTo": SVM_ADDRESS,
                    "price": "$0.001",
                    "network": SVM_NETWORK,
                },
                "extensions": {
                    **declare_discovery_extension(
                        output=OutputConfig(
                            example={
                                "message": "Access granted to SVM protected resource",
                                "timestamp": "2024-01-01T00:00:00Z",
                            },
                            schema={
                                "properties": {
                                    "message": {"type": "string"},
                                    "timestamp": {"type": "string"},
                                },
                                "required": ["message", "timestamp"],
                            },
                        )
                    ),
                },
            },
        }
        if SVM_ADDRESS
        else {}
    ),
    **(
        {
            "GET /protected-tron": {
                "accepts": {
                    "scheme": "exact",
                    "payTo": TRON_ADDRESS,
                    "price": "$0.01",
                    "network": TRON_NETWORK,
                    "extra": {
                        "assetTransferMethod": "permit2",
                        "permit2FacilitatorAddress": TRON_FACILITATOR_ADDRESS,
                    },
                },
                "extensions": {
                    **declare_discovery_extension(
                        output=OutputConfig(
                            example={
                                "message": "Access granted to TRON protected resource",
                                "timestamp": "2024-01-01T00:00:00Z",
                            },
                            schema={
                                "properties": {
                                    "message": {"type": "string"},
                                    "timestamp": {"type": "string"},
                                },
                                "required": ["message", "timestamp"],
                            },
                        )
                    ),
                    **declare_trc20_approval_gas_sponsoring_extension(
                        description="TRC-20 approval gas sponsoring (Permit2)",
                    ),
                },
            },
        }
        if TRON_ADDRESS and TRON_FACILITATOR_ADDRESS
        else {}
    ),
    **(
        {
            "GET /protected-tron-permit2": {
                "accepts": {
                    "scheme": "exact",
                    "payTo": TRON_ADDRESS,
                    "price": "$0.01",
                    "network": TRON_NETWORK,
                    "extra": {
                        "assetTransferMethod": "permit2",
                        "permit2FacilitatorAddress": TRON_FACILITATOR_ADDRESS,
                    },
                },
                "extensions": {
                    **declare_discovery_extension(
                        output=OutputConfig(
                            example={
                                "message": "Access granted to TRON Permit2 resource",
                                "timestamp": "2024-01-01T00:00:00Z",
                            },
                            schema={
                                "properties": {
                                    "message": {"type": "string"},
                                    "timestamp": {"type": "string"},
                                },
                                "required": ["message", "timestamp"],
                            },
                        )
                    ),
                    **declare_trc20_approval_gas_sponsoring_extension(
                        description="TRC-20 approval gas sponsoring (Permit2)",
                    ),
                },
            },
        }
        if TRON_ADDRESS and TRON_FACILITATOR_ADDRESS
        else {}
    ),
}


# Apply payment middleware
@app.middleware("http")
async def x402_payment_middleware(request, call_next):
    return await payment_middleware(routes, server)(request, call_next)


# Global flag to track if server should accept new requests
shutdown_requested = False


@app.get("/protected")
async def protected_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to protected resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-2")
async def protected_endpoint_2() -> Dict[str, Any]:
    """Protected endpoint that requires ERC20 payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to protected resource #2",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-permit2")
async def protected_permit2_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires Permit2 payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to Permit2 protected resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-svm")
async def protected_svm_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires SVM (Solana) payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to SVM protected resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-tron")
async def protected_tron_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires TRON payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to TRON protected resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-tron-permit2")
async def protected_tron_permit2_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires TRON Permit2 payment."""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to TRON Permit2 resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": "2024-01-01T00:00:00Z",
        "server": "fastapi",
    }


@app.post("/close")
async def close_server() -> Dict[str, Any]:
    """Graceful shutdown endpoint."""
    global shutdown_requested
    shutdown_requested = True

    # Schedule server shutdown after response
    async def delayed_shutdown():
        await asyncio.sleep(0.1)
        os.kill(os.getpid(), signal.SIGTERM)

    asyncio.create_task(delayed_shutdown())

    return {
        "message": "Server shutting down gracefully",
        "timestamp": "2024-01-01T00:00:00Z",
    }


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    print("Received shutdown signal, exiting...")
    sys.exit(0)


if __name__ == "__main__":
    # Set up signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    import uvicorn

    print(f"Starting FastAPI server on port {PORT}")
    print(f"EVM address: {EVM_ADDRESS}")
    print(f"SVM address: {SVM_ADDRESS}")
    print(f"EVM Network: {EVM_NETWORK}")
    print(f"SVM Network: {SVM_NETWORK}")
    print(f"Using facilitator: {FACILITATOR_URL}")
    print("Server listening on port", PORT)

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
