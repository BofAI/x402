# bankofai.x402 Python SDK

Core implementation of the x402 payment protocol. Provides transport-agnostic client, server, and facilitator components with both async and sync variants.

## Installation

Install the package with your preferred framework/client:

```bash
# HTTP clients (pick one)
uv add bankofai.x402[httpx]      # httpx client
uv add bankofai.x402[requests]   # requests client

# Server frameworks (pick one)
uv add bankofai.x402[fastapi]    # FastAPI middleware
uv add bankofai.x402[flask]      # Flask middleware

# Blockchain mechanisms (pick one or all)
uv add bankofai.x402[tron]       # TRON
uv add bankofai.x402[evm]        # EVM/Ethereum/BSC
uv add bankofai.x402[svm]        # Solana

# Multiple extras
uv add "bankofai.x402[fastapi,httpx,tron,evm]"

# Everything
uv add "bankofai.x402[all]"
```

## Quick Start

### Client (Async)

```python
from bankofai.x402 import x402Client
from bankofai.x402.mechanisms.tron.exact import ExactTronClientScheme
from bankofai.x402.mechanisms.evm.exact import ExactEvmScheme

client = x402Client()
# Register TRON and EVM handlers
client.register("tron:*", ExactTronClientScheme(signer=my_tron_signer))
client.register("eip155:*", ExactEvmScheme(signer=my_evm_signer))

# Create payment from 402 response
payload = await client.create_payment_payload(payment_required)
```

### Client (Sync)

```python
from bankofai.x402 import x402ClientSync
from bankofai.x402.mechanisms.tron.exact import ExactTronClientScheme

client = x402ClientSync()
client.register("tron:*", ExactTronClientScheme(signer=my_tron_signer))

payload = client.create_payment_payload(payment_required)
```

### Server (Async)

```python
from bankofai.x402 import x402ResourceServer, ResourceConfig
from bankofai.x402.http import HTTPFacilitatorClient
from bankofai.x402.mechanisms.tron.exact import ExactTronServerScheme

facilitator = HTTPFacilitatorClient(url="https://x402.org/facilitator")
server = x402ResourceServer(facilitator)
server.register("tron:*", ExactTronServerScheme())
server.initialize()

# Build requirements
config = ResourceConfig(
    scheme="exact",
    network="tron:mainnet", # TRON Mainnet
    pay_to="T...",
    price="$0.01",
)
requirements = server.build_payment_requirements(config)

# Verify payment
result = await server.verify_payment(payload, requirements[0])
```

### Server (Sync)

```python
from bankofai.x402 import x402ResourceServerSync, ResourceConfig
from bankofai.x402.http import HTTPFacilitatorClientSync
from bankofai.x402.mechanisms.tron.exact import ExactTronServerScheme

facilitator = HTTPFacilitatorClientSync(url="https://x402.org/facilitator")
server = x402ResourceServerSync(facilitator)
server.register("tron:*", ExactTronServerScheme())
server.initialize()

result = server.verify_payment(payload, requirements[0])
```

### Facilitator (Async)

```python
from bankofai.x402 import x402Facilitator
from bankofai.x402.mechanisms.tron.exact import ExactTronFacilitatorScheme

facilitator = x402Facilitator()
facilitator.register(
    ["tron:mainnet", "tron:nile"], # Mainnet and Nile
    ExactTronFacilitatorScheme(wallet=wallet),
)

result = await facilitator.verify(payload, requirements)
if result.is_valid:
    settle_result = await facilitator.settle(payload, requirements)
```

### Facilitator (Sync)

```python
from bankofai.x402 import x402FacilitatorSync
from bankofai.x402.mechanisms.tron.exact import ExactTronFacilitatorScheme

facilitator = x402FacilitatorSync()
facilitator.register(
    ["tron:mainnet"],
    ExactTronFacilitatorScheme(wallet=wallet),
)

result = facilitator.verify(payload, requirements)
```

## Async vs Sync

Each component has both async and sync variants:

| Async (default) | Sync |
|-----------------|------|
| `x402Client` | `x402ClientSync` |
| `x402ResourceServer` | `x402ResourceServerSync` |
| `x402Facilitator` | `x402FacilitatorSync` |
| `HTTPFacilitatorClient` | `HTTPFacilitatorClientSync` |

Async variants support both sync and async hooks (auto-detected). Sync variants only support sync hooks and raise `TypeError` if async hooks are registered.

### Framework Pairing

| Framework | HTTP Client | Server | Facilitator Client |
|-----------|-------------|--------|-------------------|
| FastAPI | httpx | `x402ResourceServer` | `HTTPFacilitatorClient` |
| Flask | requests | `x402ResourceServerSync` | `HTTPFacilitatorClientSync` |

Mismatched variants raise `TypeError` at runtime.

## Client Configuration

Use `from_config()` for declarative setup:

```python
from bankofai.x402 import x402Client, x402ClientConfig, SchemeRegistration
from bankofai.x402.mechanisms.tron.exact import ExactTronScheme
from bankofai.x402.mechanisms.evm.exact import ExactEvmScheme

config = x402ClientConfig(
    schemes=[
        SchemeRegistration(network="tron:*", client=ExactTronScheme(tron_signer)),
        SchemeRegistration(network="eip155:*", client=ExactEvmScheme(evm_signer)),
    ],
    policies=[prefer_network("tron:mainnet")],
)
client = x402Client.from_config(config)
```

## Policies

Filter or prioritize payment requirements:

```python
from bankofai.x402 import prefer_network, prefer_scheme, max_amount

client.register_policy(prefer_network("tron:mainnet"))
client.register_policy(prefer_scheme("exact"))
client.register_policy(max_amount(1_000_000))  # 1 USDC (6 decimals) max
```

## Lifecycle Hooks

### Client Hooks

```python
from bankofai.x402 import AbortResult, RecoveredPayloadResult

def before_payment(ctx):
    print(f"Creating payment for: {ctx.selected_requirements.network}")
    # Return AbortResult(reason="...") to cancel

def after_payment(ctx):
    print(f"Payment created: {ctx.payment_payload}")

def on_failure(ctx):
    print(f"Payment failed: {ctx.error}")
    # Return RecoveredPayloadResult(payload=...) to recover

client.on_before_payment_creation(before_payment)
client.on_after_payment_creation(after_payment)
client.on_payment_creation_failure(on_failure)
```

### Server Hooks

```python
server.on_before_verify(lambda ctx: print(f"Verifying: {ctx.payload}"))
server.on_after_verify(lambda ctx: print(f"Result: {ctx.result.is_valid}"))
server.on_verify_failure(lambda ctx: print(f"Failed: {ctx.error}"))

server.on_before_settle(lambda ctx: ...)
server.on_after_settle(lambda ctx: ...)
server.on_settle_failure(lambda ctx: ...)
```

### Facilitator Hooks

```python
facilitator.on_before_verify(...)
facilitator.on_after_verify(...)
facilitator.on_verify_failure(...)
facilitator.on_before_settle(...)
facilitator.on_after_settle(...)
facilitator.on_settle_failure(...)
```

## Network Pattern Matching

Register handlers for network families using wildcards:

```python
# All EVM networks
client.register("eip155:*", ExactEvmScheme(signer))

# Specific network (takes precedence)
client.register("eip155:8453", CustomScheme())
```

## HTTP Headers

### V2 Protocol (Current)

| Header | Description |
|--------|-------------|
| `PAYMENT-SIGNATURE` | Base64-encoded payment payload |
| `PAYMENT-REQUIRED` | Base64-encoded payment requirements |
| `PAYMENT-RESPONSE` | Base64-encoded settlement response |

### V1 Protocol (Legacy)

| Header | Description |
|--------|-------------|
| `X-PAYMENT` | Base64-encoded payment payload |
| `X-PAYMENT-RESPONSE` | Base64-encoded settlement response |

## Related Modules

- `x402.http` - HTTP clients, middleware, and facilitator client
- `x402.mechanisms.evm` - EVM/Ethereum implementation
- `x402.mechanisms.svm` - Solana implementation
- `x402.extensions` - Protocol extensions (Bazaar discovery)

## Examples

See [examples/python](https://github.com/coinbase/x402/tree/main/examples/python).
