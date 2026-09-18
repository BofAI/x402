# Upto facilitator (EVM + TRON)

HTTP facilitator exposing `/verify`, `/settle`, `/supported` for the **`upto`**
scheme. On verify it checks the client's Permit2 authorization (capped at the
advertised maximum); on settle it submits the on-chain Permit2 `settle` tx for
the amount the server requested (≤ max) via the upto proxy contract.

Key custody stays in `@bankofai/agent-wallet`; the viem `publicClient` / `TronWeb`
instances are key-less (reads + broadcast only). Per-chain setup lives in
`src/chains/`; each registers only when its wallet resolves, so it runs EVM-only,
TRON-only, or both.

## Prerequisites

- A wallet via `@bankofai/agent-wallet` (`AGENT_WALLET_PRIVATE_KEY`); one key
  serves both chains. The facilitator address must hold gas (BNB on BSC, TRX on
  TRON) to broadcast settlements.
- For BSC testnet, set `EVM_RPC_URL` to a reachable RPC endpoint; viem's default
  public endpoint may refuse connections.

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-upto-facilitator dev   # from repo root
```

Listens on `FACILITATOR_PORT` (default **4052**). Start it **first**, before the
server and client.

## Notes

- The upto Permit2 proxy is a deterministic CREATE2 singleton on EVM (same
  address on every chain) and is deployed per-network on TRON (`tron:3448148188` /
  `tron:728126428`).
- The settled amount is bounded by the client's Permit2 witness — the facilitator
  cannot settle more than the authorized maximum.
