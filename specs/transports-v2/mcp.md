# Transport: MCP

## 1. Scope

The MCP transport applies the x402 v2 payment lifecycle to paid Model Context Protocol tool calls.
It is implemented by `@bankofai/x402-mcp`.

## 2. Flow

1. The client calls a paid tool without payment.
2. The server returns a `PaymentRequired` challenge.
3. The client selects a requirement and creates a `PaymentPayload`.
4. The client retries with the payload in `_meta["x402/payment"]`.
5. The server verifies payment, runs the tool, and settles.
6. A successful result carries `SettleResponse` in `_meta["x402/payment-response"]`.

## 3. Payment challenge result

The BANK OF AI server wrapper returns a normal MCP tool result with `isError: true` and the same
`PaymentRequired` in two representations:

- `structuredContent`: the direct object; and
- `content[0].text`: `JSON.stringify(PaymentRequired)`.

```json
{
  "isError": true,
  "structuredContent": {
    "x402Version": 2,
    "error": "Payment required to access this tool",
    "resource": {
      "url": "mcp://tool/financial_analysis",
      "description": "Financial analysis",
      "mimeType": "application/json"
    },
    "accepts": [
      {
        "scheme": "exact",
        "network": "tron:0x2b6653dc",
        "amount": "1000000",
        "asset": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        "payTo": "TReceiverAddress",
        "maxTimeoutSeconds": 60,
        "extra": {
          "assetTransferMethod": "eip3009",
          "name": "Tether USD",
          "version": "1"
        }
      }
    ]
  },
  "content": [
    {
      "type": "text",
      "text": "{\"x402Version\":2,\"error\":\"Payment required to access this tool\",\"resource\":{...},\"accepts\":[...]}"
    }
  ]
}
```

Clients SHOULD prefer `structuredContent` and fall back to parsing the first text content item.

For interoperability with other MCP servers, the BANK OF AI client also recognizes a thrown payment
error with code `402`, and the MCP `UrlElicitationRequired` code `-32042`. In the `-32042` form,
`PaymentRequired` may be `error.data` directly or `error.data.x402`.

## 4. Payment payload

On retry, the client places the direct `PaymentPayload` object in the call metadata. It is not Base64
encoded:

```json
{
  "method": "tools/call",
  "params": {
    "name": "financial_analysis",
    "arguments": {
      "ticker": "0700.HK"
    },
    "_meta": {
      "x402/payment": {
        "x402Version": 2,
        "resource": {
          "url": "mcp://tool/financial_analysis",
          "description": "Financial analysis",
          "mimeType": "application/json"
        },
        "accepted": {
          "scheme": "exact",
          "network": "tron:0x2b6653dc",
          "amount": "1000000",
          "asset": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          "payTo": "TReceiverAddress",
          "maxTimeoutSeconds": 60,
          "extra": {
            "assetTransferMethod": "eip3009",
            "name": "Tether USD",
            "version": "1"
          }
        },
        "payload": {
          "signature": "0x...",
          "authorization": {
            "from": "TPayerAddress",
            "to": "TReceiverAddress",
            "value": "1000000",
            "validAfter": "1786464200",
            "validBefore": "1786464300",
            "nonce": "0x..."
          }
        }
      }
    }
  }
}
```

The server matches `accepted` against its post-extension requirements and validates echoed extension
data before invoking the scheme verifier.

## 5. Successful result

After the handler succeeds and settlement completes, the server preserves the handler result and
adds settlement metadata:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Analysis result..."
    }
  ],
  "_meta": {
    "x402/payment-response": {
      "success": true,
      "transaction": "abc123...",
      "network": "tron:0x2b6653dc",
      "payer": "TPayerAddress",
      "amount": "1000000"
    }
  }
}
```

Any pre-existing result `_meta` fields are preserved.

## 6. Failure and cancellation behavior

- Missing, unmatched, or invalid payment returns another payment challenge result.
- If a pre-execution hook blocks the call, the handler is not run and a challenge is returned.
- If the handler returns `isError: true`, settlement is not attempted and any cancellable payment is
  cancelled.
- If the handler throws, the wrapper dispatches payment cancellation and rethrows.
- If settlement throws after handler execution, the wrapper returns `isError: true` with a fresh
  `PaymentRequired` carrying the settlement error. It does not expose the tool content or attach
  `x402/payment-response` to that error result.

Clients MUST prevent repeated automatic payment attempts when a paid retry receives another
challenge. Applications SHOULD treat tool handlers as non-retriable after side effects unless their
own idempotency design makes retry safe.

## 7. References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [Model Context Protocol](https://modelcontextprotocol.io/specification/)
