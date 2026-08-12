# Transport: HTTP

## 1. Scope

The HTTP transport carries x402 v2 objects in HTTP response and request headers. It is implemented
by `@bankofai/x402-core/http` and the Fetch, Axios, Express, Hono, Fastify, and Next.js integration
packages.

All header values described here are Base64 encodings of UTF-8 JSON.

## 2. Header mapping

| Header | Direction | Encoded object |
| --- | --- | --- |
| `PAYMENT-REQUIRED` | Resource server to client | `PaymentRequired` |
| `PAYMENT-SIGNATURE` | Client to resource server | `PaymentPayload` |
| `PAYMENT-RESPONSE` | Resource server to client | `SettleResponse` |

Header names are case-insensitive as required by HTTP. This specification uses uppercase names for
clarity.

## 3. Payment challenge

When payment is required, an API response normally uses status `402` and includes a
`PAYMENT-REQUIRED` header:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json
PAYMENT-REQUIRED: <base64-json>

{}
```

Decoded header:

```json
{
  "x402Version": 2,
  "error": "PAYMENT-SIGNATURE header is required",
  "resource": {
    "url": "https://api.example.com/report",
    "description": "Premium report",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:56",
      "amount": "1000000",
      "asset": "0x55d398326f99059fF775485246999027B3197955",
      "payTo": "0x1111111111111111111111111111111111111111",
      "maxTimeoutSeconds": 60,
      "extra": {
        "assetTransferMethod": "permit2",
        "name": "USDT",
        "version": "1"
      }
    }
  ]
}
```

The body is application-defined. An HTML-capable browser may receive a generated paywall body while
the same canonical `PaymentRequired` remains in the header.

The current resource-server implementation uses status `412 Precondition Failed` when the challenge
reason is `permit2_allowance_required`; the `PAYMENT-REQUIRED` header remains unchanged.

## 4. Paid retry

The client selects one requirement, creates a scheme-specific payload, and retries the resource
request with `PAYMENT-SIGNATURE`:

```http
POST /report HTTP/1.1
Host: api.example.com
Content-Type: application/json
PAYMENT-SIGNATURE: <base64-json>

{"region":"apac"}
```

Decoded header:

```json
{
  "x402Version": 2,
  "resource": {
    "url": "https://api.example.com/report",
    "description": "Premium report",
    "mimeType": "application/json"
  },
  "accepted": {
    "scheme": "exact",
    "network": "eip155:56",
    "amount": "1000000",
    "asset": "0x55d398326f99059fF775485246999027B3197955",
    "payTo": "0x1111111111111111111111111111111111111111",
    "maxTimeoutSeconds": 60,
    "extra": {
      "assetTransferMethod": "permit2",
      "name": "USDT",
      "version": "1"
    }
  },
  "payload": {
    "signature": "0x...",
    "permit2Authorization": {
      "permitted": {
        "token": "0x55d398326f99059fF775485246999027B3197955",
        "amount": "1000000"
      },
      "from": "0x2222222222222222222222222222222222222222",
      "spender": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
      "nonce": "1234",
      "deadline": "1786464300",
      "witness": {
        "to": "0x1111111111111111111111111111111111111111",
        "validAfter": "1786464200"
      }
    }
  }
}
```

Extensions, when used, are carried in the top-level `extensions` field of both protocol objects as
defined by the core specification.

## 5. Settlement response

A successful paid response includes the application body and `PAYMENT-RESPONSE`:

```http
HTTP/1.1 200 OK
Content-Type: application/json
PAYMENT-RESPONSE: <base64-json>

{"report":"..."}
```

Decoded header:

```json
{
  "success": true,
  "transaction": "0xabc123...",
  "network": "eip155:56",
  "payer": "0x2222222222222222222222222222222222222222",
  "amount": "1000000"
}
```

If verification or settlement fails, the server returns an unpaid response and exposes the reason
through a new `PaymentRequired` challenge or a failed `SettleResponse`, depending on when the failure
occurs. Framework adapters preserve the protocol headers returned by the core resource server.

## 6. Client behavior

An automatic HTTP client SHOULD:

1. detect a `402` or `412` response with `PAYMENT-REQUIRED`;
2. decode and validate the header;
3. select one compatible requirement;
4. obtain user approval when required by policy;
5. retry only once with `PAYMENT-SIGNATURE`; and
6. expose `PAYMENT-RESPONSE` to the caller.

Clients MUST prevent unbounded retry loops. Browser integrations SHOULD expose
`PAYMENT-REQUIRED` and `PAYMENT-RESPONSE` through CORS where cross-origin callers need them.

## 7. References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [HTTP Semantics: 402 Payment Required](https://www.rfc-editor.org/rfc/rfc9110.html#name-402-payment-required)
