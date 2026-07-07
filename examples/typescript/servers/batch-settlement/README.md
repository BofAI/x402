# Batch-settlement resource server (EVM + TRON)

Express resource server that protects `GET /weather` behind the
**`batch-settlement`** scheme. The first request on a fresh channel carries an
on-chain deposit; subsequent requests are paid by off-chain vouchers. A per-chain
`BatchSettlementChannelManager` claims those vouchers and settles them to `payTo`
in the background.

Key-less: it advertises `accepts` and delegates verify/settle to the
[facilitator](../../facilitator/batch-settlement/README.md) over HTTP, which also
supplies the `receiverAuthorizer` (fetched via `/supported`).

## Prerequisites

- Set the payout address(es) you want to accept:
  - `EVM_ADDRESS` → BSC (`eip155:97`), token USDC (Permit2)
  - `TRON_ADDRESS` → TRON Nile (`tron:0xcd8690dc`), token USDT (Permit2)
- A running batch-settlement facilitator (default `FACILITATOR_URL=http://localhost:4042`).

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-batch-server dev        # from repo root
```

Listens on `SERVER_PORT` (default **4041**). Start it **after** the
facilitator and **before** the client.

## Notes

- Both chains price in `"$"` form and build the channel manager via
  `scheme.createChannelManager()`, resolving the token from the default-asset
  registry (BSC's USDC and TRON's USDT are both registered in `@bankofai/x402-evm`
  / `@bankofai/x402-tron`).
- The channel manager runs claim/settle/refund loops on short, example-friendly
  intervals (60s / 120s / 180s). On `SIGINT` it flushes pending claims before
  exiting so vouchers aren't lost.
- This example charges a fixed price per request. For usage-based billing, set a
  higher `price` (the max authorized) and call `setSettlementOverrides(res, { amount })`
  in the route handler to bill actual usage.
