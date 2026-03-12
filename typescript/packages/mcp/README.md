# @bankofai/x402-mcp

Client-first MCP integration for the x402 payment protocol. Use this package in an MCP host or application client to detect `payment required`, create x402 payments locally, and retry tool calls automatically.

## Installation

```bash
npm install @bankofai/x402-mcp @bankofai/x402-core @modelcontextprotocol/sdk
```

Related packages typically used with this package:

```bash
npm install @bankofai/x402-evm @bankofai/x402-tron
```

The primary use case is a local MCP client talking to a remote MCP server that already supports x402.

## Quick Start (Recommended)

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

### Remote Server Assumption

The remote MCP server is expected to already implement x402 on the server side. This package does not need a local bridge to work. Payment happens in the client:

1. Remote MCP server returns `payment required`
2. Local `x402MCPClient` selects requirements
3. Local signer creates the payment payload
4. Client retries the tool call with payment attached

## Client Integration

### Wrapper Functions

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

### PaymentWrapperConfig (optional server-side helper)

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `accepts` | `PaymentRequirements[]` | Yes | One or more payment requirements built by `x402ResourceServer.buildPaymentRequirements()` |
| `resource` | `object` | No | Optional MCP resource metadata |
| `hooks` | `object` | No | Optional lifecycle hooks for verification, execution, and settlement |

## Optional Server Integration

If you are building the remote MCP server yourself, the supported server pattern is:

`McpServer + x402ResourceServer + createPaymentWrapper()`

### Server - Using Payment Wrapper

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createPaymentWrapper, x402ResourceServer } from "@bankofai/x402-mcp";
import { HTTPFacilitatorClient } from "@bankofai/x402-core/server";
import { ExactEvmScheme } from "@bankofai/x402-evm/exact/server";
import { z } from "zod";

const mcpServer = new McpServer({ name: "premium-api", version: "1.0.0" });
const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("eip155:84532", new ExactEvmScheme());
await resourceServer.initialize();

const accepts = await resourceServer.buildPaymentRequirements({
  scheme: "exact",
  network: "eip155:84532",
  payTo: "0x...",
  price: "$0.10",
});

const paid = createPaymentWrapper(resourceServer, { accepts });

mcpServer.tool("financial_analysis", "Premium tool", { ticker: z.string() }, paid(async (args) => {
  return { content: [{ type: "text", text: `analysis for ${args.ticker}` }] };
}));
```

## Notes

- `@bankofai/x402-mcp` is intended to be used primarily on the client side.
- No local bridge is required if your MCP host can instantiate and use an MCP client in code.
- The examples in this repository are SSE-based. The client itself is transport-agnostic because it forwards `connect()` to the underlying MCP SDK client, but SSE is the path covered by examples and integration tests.

## License

Apache-2.0
