# v0.4.2 - GasFree Activate Fee Support

Release date: March 11, 2026

## What's New

- **GasFree activateFee in maxFee calculation**: When a TRON GasFree account has not been activated yet (`active: false`), the `activateFee` returned by the GasFree API is now automatically added to `maxFee`. This prevents transaction failures where the fee allowance was too low to cover both the transfer fee and the one-time account activation cost.

## How It Works

The GasFree API returns per-asset fee information including an optional `activateFee` field:
```json
{
  "active": false,
  "assets": [{
    "tokenAddress": "TXYZop...",
    "transferFee": "1000000",
    "activateFee": "2050000"
  }]
}
```

When `active` is `false` and `activateFee > 0`:
- `maxFee = max(transferFee, facilitatorFee) + activateFee`

When `active` is `true` (account already activated):
- `maxFee = max(transferFee, facilitatorFee)` (unchanged behavior)

## Affected SDKs

- **Python**: `bankofai-x402==0.4.2`
- **TypeScript**: `@bankofai/x402@0.4.2`

Both SDKs implement identical logic with full test coverage.
