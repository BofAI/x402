# Batch-settlement facilitator (EVM + TRON)

x402 facilitator for the **`batch-settlement`** scheme. Verifies channel deposits
and vouchers, and on settle submits the on-chain `deposit` / `claimWithSignature`
/ `settle` / `refund` transactions. Also acts as the **receiver-authorizer**: its
address is published via `/supported` and embedded into every channel config, and
it signs the EIP-712/TIP-712 claim & refund digests.

Runs EVM (BSC), TRON (Nile), or both — each chain registers only when its wallet
resolves from [`@bankofai/agent-wallet`](../../README.md).

## What it is

A payment channel amortizes gas: the payer deposits once, then pays many requests
with off-chain vouchers; the facilitator claims a batch of vouchers and settles
to the receiver in one transaction.

```
client ──deposit+voucher──▶ server ──verify/settle──▶ facilitator ──tx──▶ chain
              vouchers ────▶          (channel manager batches claims)
```

## Prerequisites

- A funded signing key in agent-wallet (`AGENT_WALLET_PRIVATE_KEY`). The
  facilitator pays gas (TRX / BNB) to submit deposits, claims, and settlements.
- Copy `../../.env-batch.example` → `../../.env-batch` and fill it in.

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-batch-facilitator dev   # from repo root
```

Listens on `FACILITATOR_PORT` (default **4042**). Start it **before** the
server. Endpoints: `POST /verify`, `POST /settle`, `GET /supported`.

## Networks

| Chain | CAIP-2 | Contract | Token (advertised by server) |
|---|---|---|---|
| BSC testnet | `eip155:97` | deterministic singleton `0x4020…0003` | USDC (Permit2) |
| TRON Nile | `tron:3448148188` | `TWBwWHZWwH8TzrZnbxit1J645VGYY1K2fA` | USDT (Permit2) |

Add a chain by extending `EVM_NETWORKS` in [`src/chains/evm.ts`](src/chains/evm.ts)
or adapting [`src/chains/tron.ts`](src/chains/tron.ts).
