---
"@bankofai/x402-core": patch
"@bankofai/x402-mcp": patch
---

Fixed cross-SDK MCP interop: optional `PaymentRequired`/`ResourceInfo`/`PaymentPayload` wire fields serialized as explicit `null` by the Python and Go SDKs are now accepted and normalized to `undefined` instead of failing validation. The MCP client routes both result and error extraction through `parsePaymentRequired`, so 402 responses from other implementations reliably trigger auto-payment.
