import os
import signal
import sys
import asyncio
from typing import Any, Dict

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from bankofai.x402.fastapi.middleware import require_payment
from bankofai.x402.types import EIP712Domain, TokenAmount, TokenAsset

# Load environment variables
load_dotenv()

# Get configuration from environment
NETWORK = os.getenv("EVM_NETWORK", "bsc-testnet")
ADDRESS = os.getenv("EVM_PAYEE_ADDRESS")
PORT = int(os.getenv("PORT", "4021"))
FACILITATOR_URL = os.getenv("FACILITATOR_URL")

if not ADDRESS:
    print("Error: Missing required environment variable ADDRESS")
    sys.exit(1)

# Explicitly define DHLU token info for BSC Testnet to avoid SDK lookup errors
# (SDK's KNOWN_TOKENS is missing bsc-testnet)
DHLU_ADDRESS = "0x375cADdd2cB68cE82e3D9B075D551067a7b4B816"
DHLU_DECIMALS = 6
DHLU_NAME = "DA HULU"
DHLU_VERSION = "1"

app = FastAPI()

# Create facilitator config if URL is provided
facilitator_config = None
if FACILITATOR_URL:
    facilitator_config = {"url": FACILITATOR_URL}
    print(f"Using remote facilitator at: {FACILITATOR_URL}")
else:
    print("Using default facilitator")

# Apply payment middleware to protected endpoints
app.middleware("http")(
    require_payment(
        path="/protected",
        price=TokenAmount(
            amount="1000",
            asset=TokenAsset(
                address=DHLU_ADDRESS,
                decimals=DHLU_DECIMALS,
                eip712=EIP712Domain(
                    name=DHLU_NAME,
                    version=DHLU_VERSION,
                ),
            ),
        ),
        pay_to_address=ADDRESS,
        network=NETWORK,
        facilitator_config=facilitator_config,
    )
)

# Add second protected endpoint with ERC20TokenAmount price
app.middleware("http")(
    require_payment(
        path="/protected-2",
        price=TokenAmount(
            amount="1000",
            asset=TokenAsset(
                address=DHLU_ADDRESS,
                decimals=DHLU_DECIMALS,
                eip712=EIP712Domain(
                    name=DHLU_NAME,
                    version=DHLU_VERSION,
                ),
            ),
        ),
        pay_to_address=ADDRESS,
        network=NETWORK,
        facilitator_config=facilitator_config,
    )
)

# Global flag to track if server should accept new requests
shutdown_requested = False


@app.get("/protected")
async def protected_endpoint() -> Dict[str, Any]:
    """Protected endpoint that requires payment"""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to protected resource",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/protected-2")
async def protected_endpoint_2() -> Dict[str, Any]:
    """Protected endpoint that requires ERC20 payment"""
    if shutdown_requested:
        raise HTTPException(status_code=503, detail="Server shutting down")

    return {
        "message": "Access granted to protected resource #2",
        "timestamp": "2024-01-01T00:00:00Z",
    }


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": "2024-01-01T00:00:00Z",
        "server": "fastapi",
    }


@app.post("/close")
async def close_server() -> Dict[str, Any]:
    """Graceful shutdown endpoint"""
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
    """Handle shutdown signals gracefully"""
    print("Received shutdown signal, exiting...")
    sys.exit(0)


if __name__ == "__main__":
    # Set up signal handlers for graceful shutdown
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    import uvicorn

    print(f"Starting FastAPI server on port {PORT}")
    print(f"Server address: {ADDRESS}")
    print(f"Network: {NETWORK}")
    print(f"Using facilitator: {FACILITATOR_URL}")
    print("Server listening on port", PORT)

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")
