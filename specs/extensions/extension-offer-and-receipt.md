# Offer and Receipt Extension

## 1. Scope

The `offer-receipt` extension lets a resource server sign two off-chain artifacts:

- an **offer**, committing to one entry in `PaymentRequired.accepts`; and
- a **receipt**, confirming a successful settlement for a resource and payer.

This document describes the x402 v2 wire format implemented by
`@bankofai/x402-extensions/offer-receipt`. It does not define protocol-v1 conversion rules.

The extension is optional. A client that does not understand it can continue the normal x402 flow.

## 2. Extension placement

The resource server declares the extension under the key `offer-receipt` and returns signed offers
in the `PaymentRequired` object:

```text
PaymentRequired.extensions["offer-receipt"].info.offers[]
```

After successful settlement, it returns one signed receipt in the `SettleResponse` object:

```text
SettleResponse.extensions["offer-receipt"].info.receipt
```

The extension object also contains a JSON Schema in its `schema` field. Offers are generated for
the requirements available to the server. A signing failure for one requirement does not prevent
other offers from being returned. No receipt is emitted when settlement fails.

## 3. Signed artifact formats

Both artifacts use one of these envelopes:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | string | Yes | `eip712` or `jws` |
| `acceptIndex` | integer | Offers only, optional | Unsigned hint into `accepts[]` |
| `payload` | object | EIP-712 only | Signed message fields |
| `signature` | string | Yes | EIP-712 hex signature or compact JWS |

For `eip712`, `payload` MUST be present and `signature` is a `0x`-prefixed ECDSA signature. For
`jws`, `payload` MUST be omitted because it is already the middle component of the compact JWS.

`acceptIndex` is not signed. Clients MAY use it as a lookup hint, but MUST confirm that the signed
offer fields match the selected `PaymentRequirements` entry.

## 4. Offer

### 4.1 Payload

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | number | Yes | Offer payload version; currently `1` |
| `resourceUrl` | string | Yes | URL of the protected resource |
| `scheme` | string | Yes | Payment scheme, such as `exact` |
| `network` | string | Yes | CAIP-2 network identifier |
| `asset` | string | Yes | Asset identifier from `PaymentRequirements` |
| `payTo` | string | Yes | Payment receiver |
| `amount` | string | Yes | Atomic-unit amount from `PaymentRequirements` |
| `validUntil` | number | Yes | Unix timestamp in seconds |

The current server derives `scheme`, `network`, `asset`, `payTo`, and `amount` without modification
from the corresponding v2 `PaymentRequirements`. By default, `validUntil` is the current time plus
`maxTimeoutSeconds`; route configuration can override it with `offerValiditySeconds`.

### 4.2 EIP-712 offer schema

Domain:

```json
{
  "name": "x402 offer",
  "version": "1",
  "chainId": 1
}
```

Primary type `Offer`:

```json
[
  { "name": "version", "type": "uint256" },
  { "name": "resourceUrl", "type": "string" },
  { "name": "scheme", "type": "string" },
  { "name": "network", "type": "string" },
  { "name": "asset", "type": "string" },
  { "name": "payTo", "type": "string" },
  { "name": "amount", "type": "string" },
  { "name": "validUntil", "type": "uint256" }
]
```

`chainId` is intentionally constant because the signature is an off-chain attestation. The actual
payment network remains part of the signed payload.

### 4.3 Example

```json
{
  "format": "eip712",
  "acceptIndex": 0,
  "payload": {
    "version": 1,
    "resourceUrl": "https://api.example.com/report",
    "scheme": "exact",
    "network": "eip155:56",
    "asset": "0x55d398326f99059fF775485246999027B3197955",
    "payTo": "0x1111111111111111111111111111111111111111",
    "amount": "1000000",
    "validUntil": 1786464300
  },
  "signature": "0x..."
}
```

## 5. Receipt

### 5.1 Payload

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `version` | number | Yes | Receipt payload version; currently `1` |
| `network` | string | Yes | Settled CAIP-2 network |
| `resourceUrl` | string | Yes | URL of the delivered resource |
| `payer` | string | Yes | Settled payer identifier |
| `issuedAt` | number | Yes | Unix timestamp in seconds |
| `transaction` | string | No | Settlement transaction hash |

Transaction disclosure is disabled by default. A route enables it with `includeTxHash: true`. A JWS
receipt omits `transaction` when it is not disclosed; an EIP-712 receipt uses an empty string because
the typed-data schema has a fixed field set.

### 5.2 EIP-712 receipt schema

Domain:

```json
{
  "name": "x402 receipt",
  "version": "1",
  "chainId": 1
}
```

Primary type `Receipt`:

```json
[
  { "name": "version", "type": "uint256" },
  { "name": "network", "type": "string" },
  { "name": "resourceUrl", "type": "string" },
  { "name": "payer", "type": "string" },
  { "name": "issuedAt", "type": "uint256" },
  { "name": "transaction", "type": "string" }
]
```

### 5.3 Example

```json
{
  "format": "jws",
  "signature": "eyJhbGciOiJFUzI1NksiLCJraWQiOiJkaWQ6d2ViOmFwaS5leGFtcGxlI2tleS0xIn0.eyJ2ZXJzaW9uIjoxLCJuZXR3b3JrIjoiZWlwMTU1OjU2IiwicmVzb3VyY2VVcmwiOiJodHRwczovL2FwaS5leGFtcGxlLmNvbS9yZXBvcnQiLCJwYXllciI6IjB4MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMiIsImlzc3VlZEF0IjoxNzg2NDY0MDAwfQ.signature"
}
```

## 6. JWS requirements

The protected header contains:

| Field | Required | Meaning |
| --- | --- | --- |
| `alg` | Yes | Signing algorithm, for example `ES256K` or `EdDSA` |
| `kid` | Yes | DID URL used to resolve the verification key |

The payload is serialized with JSON Canonicalization Scheme semantics and encoded as a compact JWS.
The SDK verifier accepts an explicit public key or resolves the `kid` forms supported by its DID
resolver, including `did:key`, `did:jwk`, and `did:web`.

## 7. Verification requirements

A client consuming an offer SHOULD:

1. verify the JWS or recover the EIP-712 signer;
2. establish that the signer is authorized for `resourceUrl`;
3. reject an expired offer;
4. match `scheme`, `network`, `asset`, `payTo`, and `amount` against the selected requirement; and
5. treat `acceptIndex` only as an unsigned hint.

A client consuming a receipt SHOULD verify the signature and signer authorization, then compare
`resourceUrl`, `network`, and `payer` with the accepted offer and local wallet. It SHOULD also enforce
an application-defined maximum receipt age.

Cryptographic signature verification alone does not prove that a key controls a resource. The DID,
TLS origin, or another trust mechanism must bind the recovered key to the resource server.

## 8. Server configuration

The TypeScript server extension is registered with an issuer created by either
`createJWSOfferReceiptIssuer` or `createEIP712OfferReceiptIssuer`. A route declares:

```ts
declareOfferReceiptExtension({
  includeTxHash: false,
  offerValiditySeconds: 300,
});
```

The default is privacy-minimal: receipt transaction hashes are excluded unless explicitly enabled.
