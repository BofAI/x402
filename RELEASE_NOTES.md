# v0.5.7 - Fallback RPC for TRON Mainnet

Release date: March 30, 2026

## New

- **Fallback RPC endpoint for mainnet**: When `TRON_GRID_API_KEY` is not set, the SDK now automatically routes TRON mainnet RPC calls to `https://hptg.bankofai.io` instead of the rate-limited TronGrid endpoint. This eliminates setup friction for developers who don't have a TronGrid API key. When `TRON_GRID_API_KEY` is set, behavior is unchanged.
- **Warning on fallback usage**: Both Python (`logger.warning`) and TypeScript (`console.warn`) emit a one-time warning when the fallback endpoint is activated, so operators are aware of the routing.
- **`getTronRpcUrl()` helper** (TypeScript): New exported function for fallback-aware TRON RPC URL resolution.
- **`TRON_MAINNET_FALLBACK_URL` constant** (Python): Exported constant for the fallback endpoint URL.

## Changes

- `resolveRpcUrl()` in TypeScript now delegates to `getTronRpcUrl()` for TRON networks, ensuring fallback logic applies consistently across all URL resolution paths.
- `TronClientSigner.getTronWeb()` uses the new helper instead of directly indexing `TRON_RPC_URLS`.

## Breaking Changes

None. Existing behavior when `TRON_GRID_API_KEY` is set is fully preserved.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.7`
- **TypeScript**: `@bankofai/x402@0.5.7`
