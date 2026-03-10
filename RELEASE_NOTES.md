# v0.4.1 - Response Model Fixes

Release date: March 7, 2026

## Fixes

- **Remove `SupportedResponse.fee` field**: The `fee` field was a single value for multiple `kinds`, which is architecturally incorrect. Fee info is now exclusively provided per-request via the `/fee/quote` endpoint, aligning with the coinbase/x402 protocol design.
- **Add missing fields to TS `FeeQuoteResponse`**: Added `scheme` and `asset` fields to the TypeScript `FeeQuoteResponse` interface.
- **Fix `SettleResponse` error paths**: Include `network` field in error responses from both `X402Facilitator` and `X402Server`.
- **Increase `FacilitatorClient` timeout**: HTTP timeout increased from 30s to 120s to accommodate GasFree settlement times (9-28s on-chain confirmation).

## Breaking Changes

- `SupportedResponse` no longer includes a `fee` field (Python and TypeScript). If you were reading `fee` from the `/supported` endpoint, use `/fee/quote` instead.
- `X402Facilitator.supported()` no longer accepts a `pricing` parameter.
