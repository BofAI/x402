# v0.5.3 - GasFree Deadline Bounds

Release date: March 27, 2026

## What's New

- **Deadline bounds enforced**: GasFree client clamps `deadline/validBefore` to provider limits.
  - mainnet: 50–600s (with 5s safety margin on max)
  - nile/shasta: 50–3600s (with 5s safety margin on max)
- **Clamp logging**: logs when the deadline is reduced to the provider max.

## Breaking Changes

None.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.3`
- **TypeScript**: `@bankofai/x402@0.5.3`

## Previously Released (0.5.2)

The following changes were released in 0.5.2 and are not new in 0.5.3:
- Mainnet GasFreeController alignment
- GasFree signing debug logs
