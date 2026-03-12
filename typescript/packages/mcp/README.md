# @bankofai/x402-mcp

MCP (Model Context Protocol) integration for the x402 payment protocol. This package enables paid tool calls in MCP servers and automatic payment handling in MCP clients.

## Installation

```bash
npm install @bankofai/x402-mcp @bankofai/x402-core @modelcontextprotocol/sdk
```

Related packages typically used with this package:

```bash
npm install @bankofai/x402-evm @bankofai/x402-tron
```

The examples in this repository use SSE transport and `createPaymentWrapper()` on the server side.

## CLI

This package also ships an `x402` command for Coinbase-style paid HTTP requests.

Install globally:

```bash
npm install -g @bankofai/x402-mcp
```

Or run from a local project:

```bash
npx -y -p @bankofai/x402-mcp x402 status
npx -y -p @bankofai/x402-mcp x402 balance
npx -y -p @bankofai/x402-mcp x402 pay https://example.com/api/weather
```

Common options:

```bash
x402 pay <url> \
  -X POST \
  -d '{"prompt":"hello"}' \
  -q '{"verbose":"true"}' \
  -h '{"X-App":"demo"}' \
  --network nile \
  --asset USDT \
  --pair tron:nile:USDT \
  --max-amount 100000
```

Selection priority when an endpoint returns multiple `accepts` options:

1. `network + pair/asset`
2. `network`
3. first available option

`x402 balance` shows native balances and, when known, the default payment token for that network. To inspect a specific payment token balance, pass `--network` and `--asset` (or `--pair`).

## MCP Server Quick Start

This package also ships a stdio MCP server so MCP hosts can install it directly.

Claude Desktop:

```bash
claude mcp add -e TRON_PRIVATE_KEY=xxx -e EVM_PRIVATE_KEY=xxx x402 -- npx -y @bankofai/x402-mcp
```

Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "x402": {
      "command": "npx",
      "args": ["-y", "@bankofai/x402-mcp"],
      "env": {
        "TRON_PRIVATE_KEY": "YOUR_TRON_KEY",
        "EVM_PRIVATE_KEY": "YOUR_EVM_KEY",
        "TRON_GRID_API_KEY": "OPTIONAL_TRONGRID_KEY",
        "BSC_TESTNET_RPC_URL": "OPTIONAL_RPC",
        "BSC_MAINNET_RPC_URL": "OPTIONAL_RPC"
      }
    }
  }
}
```

Provided tools:

- `x402_status`
- `x402_balance`
- `x402_pay`

## Quick Start (Recommended)

### Server - Using Payment Wrapper

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper, x402ResourceServer } from "@bankofai/x402-mcp";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/server";
import { z } from "zod";

// Create standard MCP server
const mcpServer = new McpServer({ name: "premium-api", version: "1.0.0" });

// Set up x402 for payment handling
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("eip155:84532", new ExactEvmScheme());
await resourceServer.initialize();

// Build payment requirements
const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.10",
});

// Create payment wrapper with accepts array
const paid = createPaymentWrapper(resourceServer, {
  accepts,
});

// Register paid tools - wrap handler
mcpServer.tool(
  "financial_analysis",
  "Advanced AI-powered financial analysis. Costs $0.10.",
  { ticker: z.string() },
  paid(async (args) => {
    return { content: [{ type: "text", text: `analysis for ${args.ticker}` }] };
  }),
);

// Register free tools - no wrapper needed
mcpServer.tool("ping", "Health check", {}, async () => ({
  content: [{ type: "text", text: "pong" }],
}));

// Connect to transport
await mcpServer.connect(transport);
```

### Client - Using Factory Function

```typescript
import { createx402MCPClient } from "@bankofai/x402-mcp";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

// Create client with factory (simplest approach)
const client = createx402MCPClient({
  name: "my-agent",
  version: "1.0.0",
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(walletAccount) }],
  autoPayment: true,
  onPaymentRequested: async ({ paymentRequired }) => {
    console.log(`Tool requires payment: ${paymentRequired.accepts[0].amount}`);
    return true; // Return false to deny payment
  },
});

// Connect and use
const transport = new SSEClientTransport(new URL("http://localhost:4022/sse"));
await client.connect(transport);

const result = await client.callTool("financial_analysis", { ticker: "AAPL" });
console.log(result.content);

if (result.paymentMade) {
  console.log("Payment settled:", result.paymentResponse?.transaction);
}
```

## Advanced Features

### Production Hooks

Add hooks for logging, rate limiting, receipts, and more:

```typescript
const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.10",
});

const paid = createPaymentWrapper(resourceServer, {
  accepts,
  hooks: {
    onBeforeExecution: async ({ toolName, paymentPayload }) => {
      console.log(`Executing ${toolName} for ${paymentPayload.payer}`);
      if (await isRateLimited(paymentPayload.payer)) {
        return false;
      }
      return true;
    },
    onAfterExecution: async ({ toolName, result }) => {
      await metrics.record(toolName, result.isError);
    },
    onAfterSettlement: async ({ toolName, settlement, paymentPayload }) => {
      await sendReceipt(paymentPayload.payer, {
        tool: toolName,
        transaction: settlement.transaction,
        network: settlement.network,
      });
    },
  },
});

mcpServer.tool("search", "Premium search", { query: z.string() }, paid(async () => ({
  content: [{ type: "text", text: "ok" }],
})));
```

### Multiple Wrappers with Different Prices

```typescript
const basicAccepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.05",
});

const premiumAccepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.50",
});

const paidBasic = createPaymentWrapper(resourceServer, { accepts: basicAccepts });
const paidPremium = createPaymentWrapper(resourceServer, { accepts: premiumAccepts });

mcpServer.tool("basic_search", "...", {}, paidBasic(async () => ({ content: [] })));
mcpServer.tool("premium_search", "...", {}, paidPremium(async () => ({ content: [] })));
```

### Multiple Payment Options

```typescript
const exactPayment = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.10",
});

const subscriptionPayment = await resourceServer.buildPaymentRequirements({
  scheme: "subscription",
  network: "eip155:1",
  payTo: "0x...",
  price: "$50",
});

const paid = createPaymentWrapper(resourceServer, {
  accepts: [exactPayment[0], subscriptionPayment[0]],
});
```

### Client - Wrapper Functions

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  wrapMCPClientWithPayment,
  wrapMCPClientWithPaymentFromConfig,
} from "@bankofai/x402-mcp";
import { x402Client } from "@bankofai/x402-core/client";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/client";

// Option 1: Wrap existing client with existing payment client
const mcpClient = new Client({ name: "my-agent", version: "1.0.0" });
const paymentClient = new x402Client()
  .register("eip155:84532", new ExactEvmScheme(walletAccount));

const x402Mcp = wrapMCPClientWithPayment(mcpClient, paymentClient, {
  autoPayment: true,
});

// Option 2: Wrap existing client with config
const x402Mcp2 = wrapMCPClientWithPaymentFromConfig(mcpClient, {
  schemes: [{ network: "eip155:84532", client: new ExactEvmScheme(walletAccount) }],
});
```

### Client Hooks

```typescript
const client = createx402MCPClient({...});

client.onPaymentRequired(async ({ toolName, paymentRequired }) => {
  const cached = await cache.get(toolName);
  if (cached) return { payment: cached };
});

client.onBeforePayment(async ({ paymentRequired }) => {
  await logPaymentAttempt(paymentRequired);
});

client.onAfterPayment(async ({ paymentPayload, settleResponse }) => {
  await saveReceipt(settleResponse?.transaction);
});
```

## Payment Flow

1. **Client calls tool** → No payment attached
2. **Server returns 402** → PaymentRequired in structured result (see SDK Limitation below)
3. **Client creates payment** → Using x402Client
4. **Client retries with payment** → PaymentPayload in `_meta["x402/payment"]`
5. **Server verifies & executes** → Tool runs if payment valid
6. **Server settles payment** → Transaction submitted
7. **Server returns result** → SettleResponse in `_meta["x402/payment-response"]`

## MCP SDK Limitation

The x402 MCP transport spec defines payment errors using JSON-RPC's native error format:
```json
{ "error": { "code": 402, "data": { /* PaymentRequired */ } } }
```

However, the MCP SDK converts `McpError` exceptions to tool results with `isError: true`, losing the `error.data` field. To work around this, we embed the error structure in the result content:

```json
{
  "content": [{ "type": "text", "text": "{\"x402/error\": {\"code\": 402, \"data\": {...}}}" }],
  "isError": true
}
```

The client parses this structure to extract PaymentRequired data. This is a pragmatic workaround that maintains compatibility while we track upstream SDK improvements.

## Configuration Options

### x402MCPClientOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoPayment` | `boolean` | `true` | Automatically retry with payment on 402 |
| `onPaymentRequested` | `function` | `() => true` | Hook for human-in-the-loop approval when payment is requested |

### PaymentWrapperConfig

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `accepts` | `PaymentRequirements[]` | Yes | One or more payment requirements built by `x402ResourceServer.buildPaymentRequirements()` |
| `resource` | `object` | No | Optional MCP resource metadata |
| `hooks` | `object` | No | Optional lifecycle hooks for verification, execution, and settlement |

## Notes

- The currently documented and tested server pattern is: native `McpServer` + `x402ResourceServer` + `createPaymentWrapper()`.
- The examples in this repository are SSE-based. The client itself is transport-agnostic because it forwards `connect()` to the underlying MCP SDK client, but SSE is the path covered by examples and integration tests.

## License

Apache-2.0
