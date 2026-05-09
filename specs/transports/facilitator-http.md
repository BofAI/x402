# Transport: Facilitator HTTP API

> Spec for the **server ↔ facilitator** transport. Distinct from the **client ↔ server** HTTP transport defined elsewhere — that one is governed by the x402 protocol headers (`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`) and HTTP 402; this one is the ordinary REST API a server uses to delegate verify / settle / fee-quote / supported queries to a facilitator.

## Summary

A facilitator exposes four HTTP endpoints. Clients of these endpoints are **resource servers** (running our middleware or equivalent), not end users.

| Endpoint | Method | Purpose |
|---|---|---|
| `/verify` | POST | Off-chain signature / replay / timing validation |
| `/settle` | POST | On-chain settlement (broadcast transaction) |
| `/supported` | GET | List supported `(x402Version, scheme, network)` tuples |
| `/fee/quote` | POST | Quote facilitator fee per requirement (optional, scheme-dependent) |

All endpoints accept and return JSON. Authorization is implementation-defined; both the BankofAI Python client and the TS client forward a configurable `headers` map (typically `Authorization: Bearer …`).

This spec is **descriptive of current implementation**. Any divergence from x402 Foundation upstream is flagged inline under "Upstream alignment notes" so future patches can converge.

---

## 1. POST /verify

### Request

```json
{
  "paymentPayload": { /* PaymentPayload */ },
  "paymentRequirements": { /* PaymentRequirements */ }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `paymentPayload` | `PaymentPayload` | yes | The signed payload submitted by the client. See `specs/protocol.md`. |
| `paymentRequirements` | `PaymentRequirements` | yes | The requirement entry from `accepts[]` that the client elected to pay. |

### Response — success

```json
{ "isValid": true }
```

### Response — failure

```json
{
  "isValid": false,
  "invalidReason": "string"
}
```

`invalidReason` is a free-form human-readable string. Common values include:

- `"unsupported_network_scheme: <network>/<scheme>"` — facilitator does not have a registered mechanism for this pair
- `"Invalid EVM address for <field>: <value>"` — checksum validation failed
- mechanism-specific reasons (e.g. `"signature mismatch"`, `"validBefore expired"`, `"nonce already used"`)

### Status codes

| Code | Meaning |
|---|---|
| 200 | Verification ran (regardless of `isValid` outcome) |
| 4xx / 5xx | Transport / facilitator infrastructure error |

The `isValid: false` path is **not** a 4xx — verification ran successfully, the result was negative.

### Upstream alignment notes

- Upstream `x402-specification-v2.md` §7.1 **wraps** the body with a top-level `x402Version: 2` field. **Our current implementation omits this field.** Both directions are tolerant of the omission today; alignment is tracked in roadmap.
- Upstream successful response includes `payer: "0x…"`. Ours does not currently emit `payer`.

---

## 2. POST /settle

### Request

Identical to `/verify`:

```json
{
  "paymentPayload": { /* PaymentPayload */ },
  "paymentRequirements": { /* PaymentRequirements */ }
}
```

### Response — success

```json
{
  "success": true,
  "transaction": "0x…",
  "network": "tron:nile"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `success` | `boolean` | yes | `true` on settlement |
| `transaction` | `string` | yes (on success) | Transaction hash. EVM = 0x-prefixed hex; TRON = 64-hex (no prefix). |
| `network` | `string` | yes | CAIP-2 identifier (`tron:<name>` or `eip155:<chainId>`) |

### Response — failure

```json
{
  "success": false,
  "errorReason": "string",
  "network": "tron:nile",
  "transaction": "0x…"
}
```

`transaction` is optional on failure (e.g. the tx was broadcast but reverted on-chain — the hash is still useful for diagnosis).

### Status codes

Same as `/verify`. Mechanism failures surface as `success: false` + `errorReason`, not 4xx / 5xx.

### Upstream alignment notes

- Upstream §7.2 includes `payer` on both success and failure responses. Ours does not.

---

## 3. GET /supported

Used by clients to discover what the facilitator can handle before posting a verify/settle.

### Response

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "tron:mainnet" },
    { "x402Version": 2, "scheme": "exact_permit", "network": "tron:mainnet" },
    { "x402Version": 2, "scheme": "exact_gasfree", "network": "tron:nile" },
    { "x402Version": 2, "scheme": "exact_permit", "network": "eip155:97" }
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `kinds` | array | yes | One entry per registered `(x402Version, scheme, network)` |
| `kinds[].x402Version` | number | yes | Always `2` in current code |
| `kinds[].scheme` | string | yes | Scheme identifier (`exact`, `exact_permit`, `exact_gasfree`, ...) |
| `kinds[].network` | string | yes | CAIP-2 identifier |

### Upstream alignment notes

- Upstream §7.3 adds two top-level fields:
  - `extensions`: array of supported extension keys (e.g. `["payment-identifier", "auth-hints"]`).
  - `signers`: map `{ "<caip-pattern>": ["0x…"] }` advertising the facilitator's signing addresses.
- Both are absent from our current response. Adding them is queued under v0.6.1 (extension framework) — `extensions` will be derivable from registered extensions; `signers` is a config addition.

---

## 4. POST /fee/quote

Optional endpoint. Returns per-requirement fee quotes. Schemes that don't charge a facilitator fee may return an empty array.

### Request

```json
{
  "accepts": [ /* PaymentRequirements[] */ ],
  "paymentPermitContext": { /* optional, scheme-defined */ }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `accepts` | array | yes | One or more `PaymentRequirements`. Same shape as the `accepts` field in `PaymentRequired`. |
| `paymentPermitContext` | object | no | Forwarded as-is to the mechanism. Used by `exact_permit` to pass `paymentId` / `nonce` / validity window. |

### Response

```json
[
  {
    "fee": { "feeTo": "T…", "feeAmount": "100000", "facilitatorId": "…", "caller": "T…" },
    "pricing": "fixed",
    "scheme": "exact_permit",
    "network": "tron:mainnet",
    "asset": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    "expiresAt": 1751234567
  }
]
```

The result array length **may be shorter than the input `accepts.length`** — entries the facilitator cannot quote (unsupported `(network, scheme)`, or mechanism returned `null`) are silently dropped.

| Field | Type | Required | Notes |
|---|---|---|---|
| `fee` | object | yes | Fee structure. `feeTo` = recipient address; `feeAmount` = smallest-unit string. `facilitatorId` is set when the facilitator wants the on-chain proxy to bind a specific signer. `caller` for schemes (e.g. `exact_permit`) where the on-chain caller must equal a specific address. |
| `pricing` | string | yes | Mechanism-defined pricing model identifier. `"fixed"` for a flat fee; mechanisms may add others. |
| `scheme` / `network` / `asset` | string | yes | Echo of the input requirement so the caller can correlate quotes back to entries. |
| `expiresAt` | number | no | Unix seconds after which this quote is no longer authoritative. |

### Upstream alignment notes

- Upstream v2 spec does not currently standardize a `/fee/quote` endpoint at the same level. Our endpoint is BankofAI-specific, motivated by `exact_permit` / `exact_gasfree` needing a facilitator fee inserted into payment requirements before signing.

---

## 5. Authorization

Authentication is implementation-defined. Recommended pattern: HTTP `Authorization: Bearer <token>` with per-tenant tokens. Both reference clients (`bankofai.x402.facilitator.FacilitatorClient` Python; `FacilitatorClient` TypeScript) accept a `headers` map at construction:

```python
FacilitatorClient(base_url="https://fac.example", headers={"Authorization": "Bearer abc"})
```

```ts
new FacilitatorClient({ baseUrl: 'https://fac.example', headers: { Authorization: 'Bearer abc' } })
```

The headers are forwarded verbatim on every request.

## 6. Timeouts and cancellation

- Default per-request timeout: **120 seconds** in both reference clients. `/settle` may take a non-trivial fraction of this on busy networks.
- Cancellation: TS client uses `AbortController`; Python client uses `httpx`'s timeout. Both surface a transport-level error to the caller — the facilitator does NOT receive a "settle was cancelled" notification.

## 7. Error handling

All transport / facilitator-side failures (non-2xx, malformed JSON, network failure) are raised to the caller as a typed exception:

| Runtime | Exception |
|---|---|
| Python | `httpx.HTTPStatusError` (from `response.raise_for_status()`) for non-2xx |
| TypeScript | `FacilitatorError` (this repo, in `src/errors.ts`) — carries `status` and `body` |

Mechanism-level failures (signature invalid, insufficient balance, etc.) are returned **inside** a 200 response as `isValid: false` / `success: false`. They are not transport errors.

---

## 8. Reference implementations

| Runtime | File |
|---|---|
| Python client | `python/x402/src/bankofai/x402/facilitator/facilitator_client.py` |
| Python server engine | `python/x402/src/bankofai/x402/facilitator/x402_facilitator.py` |
| Python server example | `examples/facilitator/server.py` |
| TypeScript client | `typescript/packages/x402/src/facilitator/client.ts` |
| TypeScript server engine | `typescript/packages/x402/src/facilitator/x402Facilitator.ts` |

The Python and TypeScript clients are byte-compatible against the same facilitator service. Tests in `python/x402/tests/facilitator/` and `typescript/packages/x402/src/facilitator/*.test.ts` cover the wire shapes documented here.

## 9. Versioning

This transport spec is implicitly tied to **x402 protocol v2**. A future protocol version that changes the wire shape MAY be carried over the same endpoint paths with a new top-level `x402Version` field discriminating the body shape.

---

## Change log

- **2026-05** — Initial draft. Captures current behaviour as of v0.6.0.
