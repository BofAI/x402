# Batch-settlement client (EVM + TRON)

Fires a burst of paid requests against a batch-settlement resource server. The
**first** request opens a payment channel (one on-chain deposit); the **rest** are
paid by off-chain vouchers — so N requests cost roughly one deposit's worth of
gas instead of N. Optionally refunds the channel's remaining balance at the end.

The chain used is decided by the payment-selection pipeline from what the server
advertises and which wallets resolve here — this client imports no chain SDK in
`index.ts`.

## Prerequisites

- A funded signing key in agent-wallet (`AGENT_WALLET_PRIVATE_KEY`) holding the
  token the server advertises:
  - BSC: USDC (Permit2) — needs a one-time `approve(Permit2)` for the payer.
  - TRON Nile: USDT (Permit2) — needs a one-time `approve(Permit2)`, which the
    client auto-broadcasts (so the payer needs a little TRX for that single tx).
- A running facilitator + server (defaults: facilitator `4042`, server `4041`).

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-batch-client dev        # from repo root
```

## Config (env)

| Var | Default | Meaning |
|---|---|---|
| `RESOURCE_URL` | `http://localhost:4041/weather` | Endpoint to hit |
| `NUMBER_OF_REQUESTS` | `3` | Requests in the burst (1 deposit + N-1 vouchers) |
| `DEPOSIT_MULTIPLIER` | `5` | Requests' worth of funds to deposit when opening |
| `CHANNEL_SALT` | zero | 32-byte hex; different salt ⇒ different channel |
| `REFUND_AFTER_REQUESTS` | `false` | Refund remaining balance after the burst |
| `REFUND_AMOUNT` | — | Base units to refund; omit for a full refund |

## End-to-end run order

```bash
# three terminals, all loading ../../.env-batch
pnpm dev:batch-facilitator     # :4042
pnpm dev:batch-server          # :4041
pnpm dev:batch-client          # deposits, sends vouchers, optional refund
```

Watch the **server** logs for `claimed … vouchers` / `settled to …` as the
channel manager batches and settles on-chain.
