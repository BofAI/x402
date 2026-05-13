# v0.6.0-beta.0 — TypeScript / Python Parity

Release date: May 12, 2026

## Highlights

This beta brings the TypeScript SDK to functional parity with the Python SDK. TS clients can now run a full facilitator engine in-process, serve framework-native middleware (Hono / Express), and call remote facilitator endpoints through a typed client.

## Changes

- **`FacilitatorClient` (TS)**: typed client for `/supported`, `/fee/quote`, `/verify`, `/settle`, mirroring the Python `bankofai.x402.facilitator.FacilitatorClient` surface.
- **`X402Facilitator` engine (TS)**: routes `(network, scheme)` to a `FacilitatorMechanism` with EVM checksum normalization. Same interface as Python.
- **`x402Hono` / `x402Express` middleware**: one-line integration for charging on Hono and Express. Framework-agnostic core lives in `processX402Request` so other adapters can be added without rewiring.
- **`X402FetchClient` extensions**: `put` / `patch` / `delete` methods, injectable `fetchImpl` / `selector`, and `parsePaymentResponseHeader()` for pulling settle receipts off success responses.
- **`FacilitatorError`**: typed facilitator HTTP / protocol error class with status + body.
- **Public header constants**: `PAYMENT_SIGNATURE_HEADER`, `PAYMENT_REQUIRED_HEADER`, `PAYMENT_RESPONSE_HEADER`.

## Verification

- TypeScript: 101/101 tests pass (50 new tests: facilitator client 11 + facilitator engine 14 + middleware core 9 + Hono adapter 5 + Express adapter 4 + fetch client 7).
- Python: 217/217 tests pass.
- TRON Nile + BSC Testnet end-to-end settle paths verified.

## Released

- npm: `@bankofai/x402@0.6.0-beta.0`
- PyPI: `bankofai-x402==0.6.0b0`

## Compatibility

- Hono and Express are optional peer deps. Apps that don't import the framework adapters do not need to install them.
- Minimum Node.js 20 (unchanged from 0.5.9). Python 3.11+.
