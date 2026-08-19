# Upto client (EVM + TRON)

Registers the **`upto`** client scheme for each configured chain, wraps `fetch`
so 402 challenges are paid automatically, then fires N usage-billed requests
against `GET /generate`. Each request signs a Permit2 authorization for up to the
server's advertised maximum; the server settles only the real usage it reports
(≤ max), so the same authorization shape can cost a different amount each time.

The chain is chosen by the payment-selection pipeline from what the server
advertises and which wallets are configured here — this client imports no chain
SDK in `index.ts`.

## Prerequisites

- A wallet via `@bankofai/agent-wallet` (`AGENT_WALLET_PRIVATE_KEY`); one key
  serves both chains.
- A running upto server (default `RESOURCE_URL=http://localhost:4051/generate`).
- **One-time `approve(Permit2)`** for the payer on the token being used
  (BSC USDC / TRON USDT). On TRON the client auto-broadcasts it; on EVM grant it
  once before the first run.
- For BSC testnet, set `EVM_RPC_URL` to a reachable RPC endpoint.

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-upto-client dev        # from repo root
```

Set `NUMBER_OF_REQUESTS` (default 3) to control how many requests are sent. Each
response shows the authorized maximum and the fraction actually charged.
