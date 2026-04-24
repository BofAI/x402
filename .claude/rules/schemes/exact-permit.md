# Scheme: `exact_permit`

**Spec**: [specs/schemes/exact-permit.md](../../../specs/schemes/exact-permit.md)

`exact_permit` pays a fixed amount using **EIP-2612 / TIP-2612 `permit`** for tokens that do not support ERC-3009 `transferWithAuthorization`. The user signs a permit; the facilitator submits `permit` + `transferFrom` as a settlement transaction.

## When to use

- Fixed price, single request, like `exact`.
- Token supports `permit` (EIP-2612) but **not** `transferWithAuthorization`.
- Payer has the token balance and can sign.

## Key invariants

- Permit is scoped to the facilitator as `spender`, not the resource server.
- `deadline` must be validated both at signing time (client) and at settlement (facilitator).
- The facilitator settlement path is **two calls on-chain** (permit + transferFrom), typically batched in a single tx.

## Common gotchas

- **Signer domain mismatch**: the permit domain (`name`, `version`, `chainId`, `verifyingContract`) must exactly match what the token contract computes on-chain. Mismatches produce valid signatures that revert on-chain with "ERC20Permit: invalid signature".
- **Replay**: nonces are per-owner. Do not cache nonces across sessions — always re-read.
- **BSC tokens**: some BSC stablecoins use a non-standard permit. Verify against the deployed token's `DOMAIN_SEPARATOR()` before shipping a new network.

## Testing

See [specs/schemes/exact-permit.md](../../../specs/schemes/exact-permit.md) for the on-chain flow. Smoke paths live in `examples/bsc-testnet-smoke/`.
