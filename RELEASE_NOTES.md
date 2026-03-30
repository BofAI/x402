# v0.5.8 - GasFree API via BankOfAI Proxy

Release date: March 30, 2026

## Changes

- **GasFree API proxy**: All GasFree API calls now route through the BankOfAI official proxy at `https://facilitator.bankofai.io/{mainnet,shasta,nile}` instead of the upstream `open.gasfree.io` / `open-test.gasfree.io` endpoints. Clients no longer need to configure `GASFREE_API_KEY` or `GASFREE_API_SECRET` environment variables.
- **Fail-fast on unsupported networks**: `getGasFreeApiBaseUrl()` / `get_gasfree_api_base_url()` now throws `UnsupportedNetworkError` for unrecognised networks instead of silently returning a wrong default URL.

## Deprecated

- `GasFreeAPIClient` constructor `apiKey`/`apiSecret` parameters are accepted but ignored with a deprecation warning. They will be removed in a future version.

## Breaking Changes

- `getGasFreeApiKey()` / `get_gasfree_api_key()` and `getGasFreeApiSecret()` / `get_gasfree_api_secret()` have been removed.
- `getGasFreeApiBaseUrl()` / `get_gasfree_api_base_url()` now throws on unknown networks instead of returning a fallback.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.8`
- **TypeScript**: `@bankofai/x402@0.5.8`
