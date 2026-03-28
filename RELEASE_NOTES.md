# v0.5.5 - GasFree Null Response Handling

Release date: March 28, 2026

## Fixes

- **Settlement crash on null status data**: GasFree status API can return `{"code": 200, "data": null}` when polled immediately after submission. This caused `AttributeError` in Python / `TypeError` in TypeScript, failing the settlement even though the on-chain transaction succeeded.
- **Transient HTTP errors crash polling loop**: `waitForSuccess` now catches transient errors (e.g. 500/503) during status polling and retries instead of aborting the settlement.
- **Silent null propagation**: `getAddressInfo`, `getProviders`, and `submit` previously returned `None`/`null` silently when the API responded with null data. They now throw explicit errors.

## Improvements

- **Timeout diagnostics**: Timeout error messages now include the number of errors encountered during polling for easier debugging.
- **Type accuracy**: `GasFreeResponse<T>.data` typed as `T | null` in TypeScript; `get_status` return type widened to `Dict | None` in Python to reflect actual API behavior.
- **Null check precision**: Python null guards use `is None` instead of `not data` to avoid false positives on empty dicts.

## Breaking Changes

None.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.5`
- **TypeScript**: `@bankofai/x402@0.5.5`
