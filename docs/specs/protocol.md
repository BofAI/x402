# x402 Protocol Specification

## Overview

x402 implements an HTTP 402 (Payment Required) challenge-response protocol for serverless blockchain payments. Three roles participate: **Client** (payer), **Server** (resource provider), and **Facilitator** (on-chain settlement).

## Protocol Version

- `x402Version`: **2**

## HTTP Flow

```
Client                          Server                      Facilitator
  |                               |                             |
  |  1. GET /resource             |                             |
  |------------------------------>|                             |
  |                               |                             |
  |  2. 402 Payment Required      |                             |
  |  Headers: PAYMENT-REQUIRED    |                             |
  |<------------------------------|                             |
  |                               |                             |
  |  (client creates signed       |                             |
  |   payment payload)            |                             |
  |                               |                             |
  |  3. GET /resource             |                             |
  |  Headers: PAYMENT-SIGNATURE   |                             |
  |------------------------------>|                             |
  |                               |  4. verify + settle         |
  |                               |----------------------------->|
  |                               |                             |
  |                               |  5. SettleResponse          |
  |                               |<-----------------------------|
  |                               |                             |
  |  6. 200 OK + resource         |                             |
  |<------------------------------|                             |
```

## HTTP Headers

| Header | Direction | Description |
|--------|-----------|-------------|
| `PAYMENT-REQUIRED` | Server -> Client | Base64-encoded `PaymentRequired` JSON (in 402 response) |
| `PAYMENT-SIGNATURE` | Client -> Server | Base64-encoded `PaymentPayload` JSON (in retry request) |
| `PAYMENT-RESPONSE` | Server -> Client | Settlement result info (in success response) |

**Encoding convention**: All header values are encoded as `Base64(UTF-8(JSON.stringify(object)))`.

The 402 response body MAY also contain `PaymentRequired` as raw JSON. Clients should try the header first, then fall back to the body.

## Constants

| Name | Value | Description |
|------|-------|-------------|
| `DeliveryKind` | `"PAYMENT_ONLY"` | Only supported delivery mode |
| `KIND_MAP` | `{ "PAYMENT_ONLY": 0 }` | Maps to uint8 for EIP-712 signing |
| Payment ID format | `0x` + 32 hex chars | 16 random bytes, used as `bytes16` in signatures |

## Wire-Format Data Structures

All structures use **camelCase** field names on the wire (JSON). Python implementations use snake_case internally with camelCase aliases.

### PaymentRequired (Server -> Client, 402 response)

```json
{
  "x402Version": 2,
  "error": "(optional) string",
  "resource": {
    "url": "(optional) string",
    "description": "(optional) string",
    "mimeType": "(optional) string"
  },
  "accepts": [ PaymentRequirements, ... ],
  "extensions": {
    "paymentPermitContext": {
      "meta": {
        "kind": "PAYMENT_ONLY",
        "paymentId": "0x...",
        "nonce": "string",
        "validAfter": 1234567890,
        "validBefore": 1234567890
      }
    }
  }
}
```

### PaymentRequirements

```json
{
  "scheme": "exact_permit | exact | exact_gasfree",
  "network": "tron:mainnet | eip155:97 | ...",
  "amount": "1000000",
  "asset": "token contract address",
  "payTo": "recipient address",
  "maxTimeoutSeconds": "(optional) int",
  "extra": {
    "name": "(optional) token name, for ERC-3009 domain",
    "version": "(optional) token version, for ERC-3009 domain",
    "fee": {
      "facilitatorId": "(optional) string",
      "feeTo": "fee recipient address",
      "feeAmount": "fee in smallest unit",
      "caller": "(optional) caller address"
    }
  }
}
```

### PaymentPayload (Client -> Server, retry request)

```json
{
  "x402Version": 2,
  "resource": {
    "url": "(optional) string",
    "description": "(optional) string",
    "mimeType": "(optional) string"
  },
  "accepted": PaymentRequirements,
  "payload": {
    "signature": "EIP-712 signature hex string",
    "merchantSignature": "(optional) string",
    "paymentPermit": PaymentPermit
  },
  "extensions": { }
}
```

### PaymentPermit

```json
{
  "meta": {
    "kind": "PAYMENT_ONLY",
    "paymentId": "0x...",
    "nonce": "string",
    "validAfter": 1234567890,
    "validBefore": 1234567890
  },
  "buyer": "payer address",
  "caller": "address authorized to call permitTransferFrom",
  "payment": {
    "payToken": "token contract address",
    "payAmount": "amount in smallest unit",
    "payTo": "recipient address"
  },
  "fee": {
    "feeTo": "fee recipient address",
    "feeAmount": "fee in smallest unit"
  }
}
```

### VerifyResponse

```json
{
  "isValid": true,
  "invalidReason": "(optional) string"
}
```

### SettleResponse

```json
{
  "success": true,
  "transaction": "(optional) tx hash string",
  "network": "(optional) network identifier",
  "errorReason": "(optional) string"
}
```

### FeeQuoteResponse

```json
{
  "fee": {
    "feeTo": "address",
    "feeAmount": "string"
  },
  "pricing": "string",
  "scheme": "exact_permit | exact | ...",
  "network": "tron:mainnet | ...",
  "asset": "token address",
  "expiresAt": "(optional) unix timestamp"
}
```

### SupportedResponse

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact_permit", "network": "tron:mainnet" },
    ...
  ]
}
```
