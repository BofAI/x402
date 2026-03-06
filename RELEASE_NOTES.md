# v0.4.1 - Response Model Fixes

Release date: March 6, 2026

## Fixes

- **Remove `SupportedResponse.fee` field**: The `fee` field was a single value for multiple `kinds`, which is architecturally incorrect. Fee info is now exclusively provided per-request via the `/fee/quote` endpoint, aligning with the coinbase/x402 protocol design.
- **Add missing fields to TS `FeeQuoteResponse`**: Added `scheme` and `asset` fields to the TypeScript `FeeQuoteResponse` interface.
- **Fix `SettleResponse` error paths**: Include `network` field in error responses from both `X402Facilitator` and `X402Server`.
- **Increase `FacilitatorClient` timeout**: HTTP timeout increased from 30s to 120s to accommodate GasFree settlement times (9-28s on-chain confirmation).

## Breaking Changes

- `SupportedResponse` no longer includes a `fee` field (Python and TypeScript). If you were reading `fee` from the `/supported` endpoint, use `/fee/quote` instead.
- `X402Facilitator.supported()` no longer accepts a `pricing` parameter.

---

# v0.4.0 - GasFree Support & Signer Standardization

Release date: February 25, 2026

## Highlights

- **Full GasFree Integration**: Pay-per-request using TRC20 tokens (USDT/USDD) without requiring TRX for gas.
- **Facilitator Provider Selection**: Facilitator's `fee_quote()` selects GasFree providers and returns them to clients via `feeTo`/`caller`, centralizing provider management.
- **Domain Neutral Signers**: Core signers support arbitrary EIP-712 / TIP-712 domains and primary types.
- **Enhanced Reliability**: Transaction polling with 3-minute timeout and "Confirmed on Chain" grace success detection.

## New Features

### GasFree Scheme (TRON)
- `ExactGasFreeFacilitatorMechanism.fee_quote()` selects a GasFree provider and returns it in the fee quote response.
- Client mechanisms use the provider from `requirements.extra.fee.feeTo`, with automatic fallback to fetching from the GasFree API.
- Asynchronous settlement via official HTTP Proxy with real-time status tracking.
- Comprehensive facilitator validation: token whitelist, fee amount floor, deadline expiry, provider allowlist.
- Client `maxFee` calculated as `max(transferFee, facilitatorFee)`.

### Standardized Signers
- Unified `sign_typed_data` and `verify_typed_data` interfaces across TRON and EVM.
- Explicit `primary_type` parameter for signature consistency.
- `EIP712Domain` no longer included in type dictionaries — domain is passed separately, consistent with ethers v6 / TronWeb v6 conventions.

## Migration Guide

### Signer Interface Change
The `sign_typed_data` and `verify_typed_data` methods now require an additional `primary_type` argument.

**Python:**
```python
# Old
await signer.sign_typed_data(domain, types, message)
# New
await signer.sign_typed_data(domain, types, message, primary_type="YourType")
```

---

# v0.1.6 - TronGrid API Key support

Release date: February 6, 2026

## New Features

- Add TronGrid API key support to the tronpy client via `TRON_GRID_API_KEY`.

## Usage

Set the API key in your shell environment:

```bash
export TRON_GRID_API_KEY="your-api-key-here"
```