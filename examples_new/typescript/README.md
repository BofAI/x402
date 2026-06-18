# x402 TypeScript examples (EVM + TRON)

Runnable examples for the `@bankofai/x402-*` SDK, scoped to **EVM and TRON**.

The x402 core is chain-agnostic; each example registers chains at one boundary
(`src/chains/{evm,tron}.ts`) and self-skips a chain whose credentials are absent
— so you can run EVM-only, TRON-only, or both.

## The main line

A full client → server → facilitator loop:

| Example | Role | Port | Wallet |
|---|---|---|---|
| [`facilitator/basic`](facilitator/basic) | verifies + settles on-chain | 4022 | agent-wallet (EVM + TRON) |
| [`servers/express`](servers/express) | sells `GET /weather` behind 402 | 4021 | none (keyless, payout address only) |
| [`clients/fetch`](clients/fetch) | pays automatically via wrapped `fetch` | — | agent-wallet (EVM + TRON) |

## Wallet model

Signing uses `@bankofai/agent-wallet` (`resolveWallet({ network })`) — **examples
never read a raw private key**. The signer factories are wallet-only:

| | client | facilitator |
|---|---|---|
| EVM | `createClientEvmSigner` | `createFacilitatorEvmSigner` |
| TRON | `createClientTronSigner` | `createFacilitatorTronSigner` |

The viem `publicClient` / `TronWeb` instances carry no account — they only do
chain reads and broadcast.

## Run

```bash
pnpm install           # links the in-repo SDK packages (see pnpm-workspace.yaml)

# Each app reads its own .env-local — configure the wallet/addresses first.
pnpm dev:facilitator   # terminal 1  (:4022)
pnpm dev:server        # terminal 2  (:4021)
pnpm dev:client        # terminal 3
```

Configure wallets via agent-wallet (`AGENT_WALLET_PRIVATE_KEY` for EVM,
`TRON_PRIVATE_KEY` for TRON) and set the server's payout addresses
(`EVM_ADDRESS` / `TRON_ADDRESS`). See `.env-local.example`.

## Relationship to `tests/integrations`

These examples are **onboarding templates**, not tests — no assertions, run by
hand. The protocol-correctness coverage (assertions, scheme×network matrix,
CI-gated) lives in each mechanism package's `test/integrations/`.
