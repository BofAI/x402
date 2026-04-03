# Research: Exact Scheme V2 Compatibility

## Normative Baseline

- Treat Coinbase x402 v2 as the source of truth for `exact` on the current EVM path.
- HTTP transport remains based on HTTP `402 Payment Required` plus the `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers.
- The required v2 `exact` payment shape places transfer authorization data in `payload.authorization`.

## Current Repository Deviations

### Shared Payload Shape

- TypeScript currently models `PaymentPayload.payload` as permit-centric and only exposes `paymentPermit` as the scheme-specific payload field.
- Python currently mirrors the same assumption in `PaymentPayloadData`.
- Result: `exact` is forced into an extension-based escape hatch instead of being represented as a first-class v2 payload.

### Exact Client Generation

- TypeScript `nativeExactEvm.ts` and `nativeExactTron.ts` generate transfer authorization data into `extensions.transferAuthorization`.
- Python `_exact_base/base.py` does the same.
- Result: a standard v2 server expecting `payload.authorization` will not accept our current `exact` payload.

### Exact Server Validation

- Python `x402_server.py` still validates incoming payloads through `payload.payload.payment_permit` in the generic server path.
- Result: `exact` requests are treated as if they were `exact_permit`, which makes the server incompatible with a standard v2 client.

### Facilitator Verification and Settlement

- Python `_exact_base/base.py` can validate and settle an authorization, but only after extracting it from `extensions.transferAuthorization`.
- Result: the exact mechanism logic is close to usable, but the entrypoint shape is non-standard.

### Metadata and Signing Context

- TypeScript `nativeExactEvm.ts` currently hardcodes token version to `"1"` when constructing the signing domain.
- Python `_exact_base/base.py` reads token metadata from the registry and falls back to `"1"` only when metadata is absent.
- Result: TypeScript and Python are inconsistent, and TypeScript may produce a signature a v2 peer rejects when versioned token metadata matters.

## Required Implementation Outcome

- Shared protocol models must support both permit-based and authorization-based payloads without forcing `exact` through extensions.
- `exact` clients must emit `payload.authorization`.
- `exact` server and facilitator paths must validate `payload.authorization` directly.
- Existing non-`exact` flows must remain intact.

## BSC Contract Alignment Clarification

### What Is Aligned With Coinbase v2

- On BSC, Coinbase v2 `exact` is aligned at the wire format and settlement semantics level:
  - `payload.authorization`
  - ERC-3009 `transferWithAuthorization`
  - HTTP `402` + `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`
- For `exact`, there is no Coinbase-specific x402 settlement contract to match. Settlement executes on the advertised token contract itself.

### What Is Not Required To Match Coinbase v2

- Our BSC `exact_permit` spender / payment-permit contract address is still our own network configuration:
  - BSC testnet: `0x1825bB32db3443dEc2cc7508b2D818fc13EaD878`
- This feature does not claim that our BSC permit contract addresses are identical to Coinbase's environment.
- This feature only claims Coinbase v2 interoperability for the BSC `exact` path.

### Token-Level Constraint On BSC

- If an endpoint advertises `scheme=exact`, the token must actually support ERC-3009 `transferWithAuthorization`.
- On our BSC testnet smoke path, the validated `exact` token is:
  - `DHLU`
  - address: `0x375cADdd2cB68cE82e3D9B075D551067a7b4B816`
- Earlier attempts that advertised `exact` on BSC testnet USDT/USDC reverted during settlement. That behavior is expected when the token does not implement the required ERC-3009 method.
