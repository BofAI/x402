# x402

x402 is an open-source SDK for the [**x402 open payment standard**](https://www.x402.org/) — a protocol built on the HTTP `402 Payment Required` status code. It enables web services to charge for APIs or content through a "pay-before-response" mechanism — without relying on traditional account systems or session management.

x402 currently supports the **TRON** and **BSC** networks, with plans to expand to a broader multi-chain ecosystem in the future.

---

**[📚 Full Documentation](https://docs.bankofai.io/)** | **[💻 Demo Repository](https://github.com/BofAI/x402-demo)**

---

## Features

- **Protocol Native**: Restores the HTTP `402` status code to its intended purpose.
- **AI Ready**: First-class support for AI Agents via specialized x402 skills.
- **Trust Minimized**: Uses structured-data signing for `eip3009`-style authorizations and `permit2` witness flows. Facilitators cannot modify payment terms.
- **Stateless & Accountless**: No user accounts or session management required. Payments are verified per request.
- **Framework Integrations**: 
    - **Python**: FastAPI, Flask, httpx
    - **TypeScript**: Native fetch, Node.js

## Installation

### Python
The Python SDK includes support for Server (FastAPI/Flask), Client, and Facilitator.

```bash
# Clone the repository
git clone https://github.com/BofAI/x402.git
cd x402/python/x402

# Install with all dependencies
pip install -e .[all]
```

### TypeScript
The current TypeScript SDK is split into focused v2 packages.

```bash
npm install @bankofai/x402-core @bankofai/x402-fetch @bankofai/x402-tron @bankofai/x402-evm
```

## AI Agent Integration

x402 is designed for the Agentic Web. AI agents can autonomously negotiate and pay for resources using the [**x402-payment**](https://github.com/BofAI/skills/tree/main/x402-payment) skill.

This skill enables agents to:

1. Detect `402 Payment Required` responses.
2. Sign x402 payment payloads automatically on TRON and EVM.
3. Manage wallet balances and handle the challenge-response loop.

## Quick Start

### 1. Facilitator
The Facilitator verifies payment payloads and executes on-chain settlements.

- **Self-Hosted**: Deploy and manage your own Facilitator instance for full control over fee policies and settlement strategies. See the [**demo repository quick start**](https://github.com/BofAI/x402-demo/tree/main?tab=readme-ov-file#quick-start) for deployment instructions.
- **Official Facilitator**: An [officially hosted Facilitator](https://github.com/BofAI/x402-facilitator) service is available, allowing you to use x402 without deploying infrastructure yourself.

### 2. Server (Seller)
The current TypeScript v2 server path uses `x402ResourceServer` from `@bankofai/x402-core`
with chain-specific `exact` schemes.

```typescript
import { HTTPFacilitatorClient, x402ResourceServer } from "@bankofai/x402-core/server";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";

const facilitator = new HTTPFacilitatorClient({ url: "http://localhost:8011" });
const server = new x402ResourceServer(facilitator);

server.register("tron:nile", new ExactTronScheme());
await server.initialize();

const accepts = await server.buildPaymentRequirements({
  scheme: "exact",
  network: "tron:nile",
  price: "$0.0001",
  payTo: "<YOUR_TRON_WALLET_ADDRESS>",
});
```

### 3. Client (Buyer)
Clients handle the `402` challenge-response loop automatically using the v2 SDK.

**TRON — TypeScript Example**
```typescript
import "dotenv/config";
import { TronWeb } from "tronweb";
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";
import { ExactTronScheme, createClientTronSigner } from "@bankofai/x402-tron";

const tronWeb = new TronWeb({
  fullHost: "https://nile.trongrid.io",
  privateKey: process.env.TRON_PRIVATE_KEY!,
});

const signer = createClientTronSigner(tronWeb, process.env.TRON_PRIVATE_KEY!);
const client = new x402Client().register("tron:nile", new ExactTronScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment("http://localhost:8010/protected-nile");
console.log(await response.json());
```

**BSC — TypeScript Example**
```typescript
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { bscTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@bankofai/x402-fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@bankofai/x402-evm";

const account = privateKeyToAccount(process.env.BSC_PRIVATE_KEY! as `0x${string}`);
const publicClient = createPublicClient({ chain: bscTestnet, transport: http(process.env.BSC_TESTNET_RPC_URL) });
const signer = toClientEvmSigner(account, publicClient);

const client = new x402Client().register("eip155:97", new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

const response = await fetchWithPayment("http://localhost:8010/protected-bsc-testnet");
console.log(await response.json());
```

### 4. Agent (Buyer)
AI agents can handle x402 payments autonomously by using the specialized payment skill.

**Configuration:**
Set your wallet credentials in the environment. The `TRON_GRID_API_KEY` is recommended to avoid rate limits on TRON RPC nodes.

```bash
# Set your wallet and network credentials
export TRON_PRIVATE_KEY="your_private_key_here"
export TRON_GRID_API_KEY="your_trongrid_api_key_here"  # Recommended
```

**Using with Agentic Tools:**
You can add the [**x402-payment**](https://github.com/BofAI/skills/tree/main/x402-payment) skill to your favorite agentic tools:

- **OpenClaw**: `npx clawhub install x402-payment`
- **opencode**: Copy the skill to your project's `.opencode/skill/` directory to enable autonomous TRON payments.

Once configured, your agent will:
1. Automatically detect when an API requires payment (`402`).
2. Negotiate terms and sign authorizations using the provided wallet.
3. Manage gas (TRX) and token (USDT/USDD) balances to ensure smooth operation.

**Try it out:** Tell your Agent to visit `https://x402-demo.bankofai.io/protected-nile`. The Agent will automatically complete the x402 payment and return the resource.

## Architecture

The x402 protocol involves three parties:

- **Client**: Entity wanting to pay for a resource
- **Resource Server**: HTTP server providing protected resources
- **Facilitator**: Server that verifies and settles payments on-chain

### Payment Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server as Resource Server
    participant Facilitator
    participant Blockchain as Blockchain

    Note over Facilitator: Facilitators are optional,<br/>all logical steps could be<br/>performed by the server<br/>when accepting stablecoins<br/>or crypto

    Client->>Server: GET /api
    Server->>Client: 402 PAYMENT-REQUIRED: {...}
    
    Note over Client: Create payment<br/>payload
    
    Client->>Server: GET /api<br/>PAYMENT-SIGNATURE: {...}
    Server->>Facilitator: POST /verify<br/>PAYMENT-SIGNATURE<br/>PAYMENT-REQUIRED
    Facilitator->>Server: 200 Verification: {...}
    
    Note over Server: Do work
    
    Server->>Facilitator: POST /settle<br/>PAYMENT-SIGNATURE<br/>PAYMENT-REQUIRED
    Facilitator->>Blockchain: Submit tx
    Blockchain->>Facilitator: tx confirmed
    Facilitator->>Server: 200 Settled, tx_hash
    Server->>Client: 200 Ok<br/>PAYMENT-RESPONSE<br/>Content
```

## Supported Networks & Assets

x402 currently supports TRC-20 tokens on the TRON network and BEP-20 tokens on the BSC network. Custom tokens can be registered via the `TokenRegistry`.

| Network | ID | Status | Recommended For |
|---------|----|--------|-----------------|
| **TRON Nile** | `tron:nile` | Testnet | **Development & Testing** |
| **TRON Shasta** | `tron:shasta` | Testnet | Alternative Testing |
| **TRON Mainnet** | `tron:mainnet` | Mainnet | Production |
| **BSC Testnet** | `eip155:97` | Testnet | **Development & Testing** |
| **BSC Mainnet** | `eip155:56` | Mainnet | Production |

**Supported Tokens:**
- **USDT** (Tether)
- **USDD** (Decentralized USD)

## Supported Payment Schemes

The x402 protocol supports multiple payment schemes to accommodate different user needs and blockchain capabilities.

| Scheme | Chain | Transfer Methods | Description |
|--------|-------|-----------------|-------------|
| **`exact`** | EVM | `eip3009`, `permit2` | Native direct payment using ERC-3009 (`TransferWithAuthorization`) or Uniswap Permit2 with witness. |
| **`exact`** | TRON | `eip3009`, `permit2` | Native direct payment using TRON `TransferWithAuthorization` (`eip3009`-style) or Permit2 with witness. |
| **`exact_permit`** | TRON, EVM | — | Standard x402 scheme using TIP-712/EIP-712 permits. Requires a `PaymentPermit` contract. |
| **`exact_gasfree`**| TRON | — | Allows users to pay with USDT/USDD without holding TRX for gas. Settled via the official GasFree Proxy. |
## Development

### Prerequisites
- Python 3.10+
- Node.js 18+
- A TRON Wallet (e.g., TronLink) with TRX for gas/energy, and/or a BSC Wallet (e.g., MetaMask) with BNB for gas.

### Configuration
Environment variables for development:
- `TRON_PRIVATE_KEY`: Required for TRON signing operations (Client/Facilitator).
- `TRON_GRID_API_KEY`: Recommended for higher TRON RPC limits.
- `BSC_PRIVATE_KEY`: Required for BSC signing operations (Client/Facilitator).

### Testing
```bash
# Run Python tests
cd python/x402 && pytest

# Run TypeScript tests
cd typescript && pnpm test
```

## Security & Risk

> [!WARNING]
> **Use at your own risk.** Handling private keys involves significant risk of asset loss.
>
> - **Never commit secrets**: Do not hardcode private keys or commit `.env` files to version control.
> - **Wallet Isolation**: Use dedicated wallets for development with only necessary funds.
> - **Environment Variables**: Always use environment variables or secure vaults to manage sensitive credentials.
> - **Protocol Status**: x402 is in active development. Ensure you test thoroughly on Nile or Shasta testnets before any mainnet deployment.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](./LICENSE) for details.
