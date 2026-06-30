# x402

Python SDK for the x402 payment protocol — supports TRON and EVM (BSC) networks.

Current release: `bankofai-x402==0.6.0`. This release is aligned with the TypeScript SDK for client, server, and facilitator `exact`, `exact_permit`, and `exact_gasfree` flows.

## Compatibility Notes

- The EVM `exact` flow is being aligned to the Coinbase x402 v2 payload shape.
- Exact transfer authorizations are represented in `payload.authorization`.
- Server-side migration fallback still accepts the legacy `extensions.transferAuthorization` field while the spec-aligned path becomes primary.

## Installation

```bash
pip install bankofai-x402==0.6.0
```

Optional extras:

```bash
pip install "bankofai-x402[tron]"
pip install "bankofai-x402[fastapi]"
pip install "bankofai-x402[flask]"
pip install "bankofai-x402[all]"
```

## Quick Start

```python
from bankofai.x402.clients import X402Client

client = X402Client()
```

If you want automatic handling of HTTP 402 responses, use `X402HttpClient`:

```python
import httpx

from bankofai.x402.clients import X402Client, X402HttpClient

x402_client = X402Client()
http_client = httpx.AsyncClient()
client = X402HttpClient(http_client=http_client, x402_client=x402_client)
```

## BSC Testnet Example

For a complete BSC testnet `exact` smoke example, including a local-private-key client and a server that advertises `DHLU` for ERC-3009, see [`examples/bsc-testnet-smoke/README.md`](../../../examples/bsc-testnet-smoke/README.md).

The key point for BSC `exact` is that the advertised asset must actually support `transferWithAuthorization`. The smoke-tested path in this repository uses `DHLU` on `eip155:97`.

## Supported Schemes

- **`exact_permit`**: Standard x402 payment scheme using TIP-712/EIP-712 permits.
- **`exact_gasfree`**: (TRON) Pay with USDT/USDD without TRX gas using the GasFree protocol.
- **`exact`**: (EVM) Native direct payment using ERC-3009.

## Links

- Repository: https://github.com/BofAI/x402
- Issues: https://github.com/BofAI/x402/issues
- Documentation: https://docs.bankofai.io/
- Contributing: [CONTRIBUTING.md](../../CONTRIBUTING.md)
