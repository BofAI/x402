# Scheme: `exact`

Code: `mechanisms/{evm,tron}/src/exact/{client,facilitator,server}`. Classes `ExactEvmScheme` / `ExactTronScheme` (same name per role, role = import subpath).

The `exact` scheme pays a fixed, pre-quoted amount in a specified token for a single request.

## When to use

- The resource has a fixed price known in advance, single request.
- The payer has the token balance and can sign.

## Transfer method — `extra.assetTransferMethod`

The single `exact` scheme covers both authorization shapes; the client picks based on `paymentRequirements.extra.assetTransferMethod` (defaults to `"eip3009"`):

- **`eip3009`** — ERC-3009 `transferWithAuthorization`. Token must support ERC-3009. **Signs offline** (no RPC). Single-step settle.
- **`permit2`** — Uniswap Permit2 (canonical singleton `0x0000…78BA3`). For tokens without ERC-3009. **Reads the chain** to sign the gas-sponsored approve, so it needs a working RPC.

A server may advertise multiple `accepts[]` entries with different `assetTransferMethod` values so the client picks whichever matches its token approvals. There is **no separate `exact_permit` scheme** — permit is a transfer method of `exact`.

## Key invariants

- `payload.authorization` carries the transfer authorization (Coinbase x402 v2 wire format).
- **`validAfter` / `validBefore`**: validate *both* on the server pre-check path.
- **Network match**: the server pre-check must verify `payload.network` matches the configured network; cross-network replay is otherwise possible.

## Common gotchas

- `eip3009` tokens (e.g. DHLU on BSC testnet) sign offline; `permit2` tokens (e.g. USDC) fail without a reachable RPC — see [networks/evm.md](../networks/evm.md) RPC note.

## Testing

Unit tests: `mechanisms/evm/test/unit/exact/**`, `mechanisms/tron/test/unit/` (`flow-integration`, `permit2-digest`).

## Safety

Signing + settlement code is **security-reviewer territory**. Route changes through `.claude/agents/security-reviewer.md`.
