# Scheme: `exact`

**Spec**: [specs/schemes/exact.md](../../../specs/schemes/exact.md)

The `exact` scheme pays a fixed, pre-quoted amount in a specified token for a single request. Uses ERC-3009-style `transferWithAuthorization` where the token supports it.

## When to use

- The resource has a fixed price known in advance.
- The token supports `transferWithAuthorization` (ERC-3009).
- The payer has the token balance and can sign.

## Key invariants

- `payload.authorization` carries the transfer authorization (aligned with Coinbase x402 v2 wire format).
- `extensions.transferAuthorization` is accepted as a temporary fallback during migration — **do not emit it in new code**.
- Settlement is single-step: the facilitator submits the signed authorization on-chain.

## Common gotchas

- **Token must support ERC-3009**. If it doesn't, use `exact_permit` instead.
- **`validAfter` / `validBefore`**: check both on the server pre-check path. See commit `c9e53b8` — missing `validAfter` check was a review finding.
- **Network match**: the server pre-check must verify `payload.network` matches the configured network; cross-network replay is otherwise possible. See commit `c9e53b8`.

## Testing

Unit tests live in `python/x402/tests/exact/` and `typescript/packages/x402/src/mechanisms/nativeExactEvm.*`.

When writing a new scenario, reuse the `exact_permit_happy_path` template as the skeleton.
