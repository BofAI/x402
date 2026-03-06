# x402

Python SDK for the x402 payment protocol (TRON-only).

## Installation

```bash
pip install bankofai-x402
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

## Supported Schemes

- **`exact_permit`**: Standard x402 payment scheme using TIP-712/EIP-712 permits.
- **`exact_gasfree`**: (TRON) Pay with USDT/USDD without TRX gas using the GasFree protocol.
- **`exact`**: (EVM) Native direct payment using ERC-3009.

## Links

- Repository: https://github.com/BofAI/x402
- Issues: https://github.com/BofAI/x402/issues
- Contributing: https://github.com/BofAI/CONTRIBUTING.md
