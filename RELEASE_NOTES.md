# v0.5.6 - GasFree Balance Check Fix

Release date: March 29, 2026

## Fixes

- **Wrong balance checked for GasFree payments**: `SufficientBalancePolicy` was querying the user's own wallet address for balance, but GasFree payments hold spendable balance in a separate custodial gasfree wallet. The policy now delegates balance checking to each mechanism via `check_balance()` / `checkBalance()`, which knows the correct address to query.
- **Redundant GasFree API call**: `create_payment_payload` in the GasFree mechanism made a second `getAddressInfo` call that was already performed during balance checking. The shared `_check_gasfree_balance` helper now eliminates this duplication.
- **Unnecessary `await` on sync method**: Removed `await` on the synchronous `getAddress()` call in TypeScript GasFree mechanism.
- **Misleading test name**: Renamed test that said "drops requirement" but actually asserted the requirement was kept.

## New

- **Mechanism-level balance checking**: `ClientMechanism` now exposes `check_balance()` / `checkBalance()`. The base class default delegates to the signer's wallet; `ExactGasFreeClientMechanism` overrides it to query the gasfree custodial address.
- **`resolve_mechanism()` / `resolveMechanism()`**: New public method on `X402Client` for policies to look up a mechanism by scheme and network.
- **Policy test suites**: Comprehensive tests for `SufficientBalancePolicy` in both Python (pytest-anyio) and TypeScript (vitest).

## Breaking Changes

None for standard `X402Client` usage. Direct callers of `SufficientBalancePolicy.apply()` should note that requirements with no matching mechanism are now dropped instead of passed through.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.6`
- **TypeScript**: `@bankofai/x402@0.5.6`
