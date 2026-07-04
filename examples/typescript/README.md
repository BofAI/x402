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
| [`servers/mcp`](servers/mcp) | sells the `get_weather` MCP tool behind 402 | 4023 | none (keyless, payout address only) |
| [`clients/mcp`](clients/mcp) | pays automatically over MCP/SSE | — | agent-wallet (EVM + TRON) |

The `mcp` pair is the same line over an **MCP transport** — it shares
`facilitator/basic` and `.env-exact`, swapping the HTTP server/client for an MCP
server (`pnpm dev:mcp-server`, :4023) and client (`pnpm dev:mcp-client`); `ping`
is free, `get_weather` is paid.

## GasFree scenario (TRON `exact_gasfree`)

A parallel, self-contained trio demonstrating TRON's **gasless** scheme: the payer
signs a TIP-712 GasFree permit and a relayer pays the on-chain energy — **no TRX
for the payer, no one-time `approve`**. Funds come from the payer's GasFree
custodial wallet (not the main wallet). TRON-only.

| Example | Role | Port |
|---|---|---|
| [`facilitator/gasfree`](facilitator/gasfree) | verifies + relays via the GasFree API | 4032 |
| [`servers/gasfree`](servers/gasfree) | sells `GET /weather` (`exact_gasfree`, USDT) | 4031 |
| [`clients/gasfree`](clients/gasfree) | pays via wrapped `fetch` | — |

```bash
pnpm dev:gasfree-facilitator   # :4032
pnpm dev:gasfree-server        # :4031
pnpm dev:gasfree-client
```

Runs on its own ports (4031/4032) via dedicated `GASFREE_*` env vars, so it never
clashes with the main line. Preconditions: the payer's GasFree account on Nile
must be **activated and funded** with USDT, or settlement fails at the relayer.

## Batch-settlement scenario (EVM + TRON `batch-settlement`)

A payment-channel trio: the payer **deposits once** on-chain, then pays many
requests with off-chain **vouchers**; the server's channel manager **claims** a
batch and **settles** to `payTo` in a single tx — so N requests cost ~one
deposit's worth of gas. Includes a **refund** path for the unused balance. Works
on BSC and TRON Nile.

| Example | Role | Port |
|---|---|---|
| [`facilitator/batch-settlement`](facilitator/batch-settlement) | verifies + submits deposit/claim/settle/refund; receiver-authorizer | 4042 |
| [`servers/batch-settlement`](servers/batch-settlement) | sells `GET /weather`, runs the channel manager | 4041 |
| [`clients/batch-settlement`](clients/batch-settlement) | deposits + sends a burst of vouchers, optional refund | — |

```bash
pnpm dev:batch-facilitator     # :4042
pnpm dev:batch-server          # :4041
pnpm dev:batch-client          # 1 deposit + N-1 vouchers
```

Own ports (4041/4042) via dedicated `BATCH_*` env vars, so it never clashes with
the other lines. BSC uses USDC (Permit2 deposit, one-time `approve(Permit2)`); TRON
Nile uses USDT (Permit2 → one-time `approve(Permit2)`, client auto-broadcasts).

## Upto scenario (EVM + TRON `upto`)

A **usage-based billing** trio: the payer signs a Permit2 authorization for up to
a **maximum** amount; the server decides the **real usage** per request and
settles only that (≤ max). One signature shape, a different charge each request.

| Example | Role | Port |
|---|---|---|
| [`facilitator/upto`](facilitator/upto) | verifies + settles the Permit2 `settle` (≤ max) | 4052 |
| [`servers/upto`](servers/upto) | sells `GET /generate`, sets the per-request charge | 4051 |
| [`clients/upto`](clients/upto) | pays via wrapped `fetch`, fires N usage-billed requests | — |

```bash
pnpm dev:upto-facilitator      # :4052
pnpm dev:upto-server           # :4051
pnpm dev:upto-client           # N usage-billed requests
```

Own ports (4051/4052) via the dedicated `.env-upto` file. The server signals the
per-request charge with a `Settlement-Overrides` response header (a percent,
atomic units, or a `$` price ≤ the advertised max); the middleware settles that
amount and strips the header. BSC uses USDC, TRON Nile uses USDT — both Permit2
(one-time `approve(Permit2)`).

## Supported chains & tokens

| Chain | Network | Token | Scheme | One-time approve | User pays gas? |
|---|---|---|---|---|---|
| TRON nile | `tron:nile` | USDT (6) | exact **permit2** | yes — client auto-broadcasts | only the approve (TRX) |
| TRON nile | `tron:nile` | USDD (18) | exact **permit2** | yes — client auto-broadcasts | only the approve (TRX) |
| BSC testnet | `eip155:97` | DHLU (6) | exact **eip3009** | none | **none (fully gasless)** |
| BSC testnet | `eip155:97` | USDC (18) | exact **permit2 + gas-sponsoring** | yes — client signs, facilitator relays | only the approve (BNB) |
| BSC testnet | `eip155:97` | USDT (18) | exact **permit2 + gas-sponsoring** | yes — client signs, facilitator relays | only the approve (BNB) |

How each token settles on-chain:

- **DHLU — eip3009 (best):** the client signs `transferWithAuthorization`
  (EIP-712, domain `("DA HULU","1")`); the facilitator submits it. No approve,
  user pays no gas. Use this whenever a token implements ERC-3009.
- **TRON USDT/USDD — permit2:** the client signs a Permit2 witness permit
  (TIP-712). On first use the client **auto-broadcasts** the one-time
  `approve(Permit2)` (`ensureAllowance`, ~3s); the facilitator settles via
  `x402Permit2Proxy.settle`. TRON has no gas delegation, so that approve costs
  the user a little TRX.
- **BSC USDC/USDT — permit2 + gas-sponsoring:** both are plain BEP-20 (no
  ERC-3009 / no EIP-2612), so each needs an on-chain `approve(Permit2)`. The
  client signs that approve **offline**; the facilitator broadcasts it bundled
  with settle (the `erc20ApprovalGasSponsoring` extension). This removes the
  separate manual approve step — but the approve's `from` is the user, so on a
  basic EOA facilitator the user still pays its BNB (true gasless needs an
  AA/paymaster facilitator).

Approve broadcasting differs by chain on purpose: TRON has no
authorizer/fee-payer split, so the **client** broadcasts it; EVM can decouple
them, so the **facilitator** relays it (leaving the door open to real
sponsorship).

### Mainnet (real funds)

Mainnet networks (`eip155:56`, `tron:mainnet`) are registered alongside their
testnet counterparts in the same tables — no uncommenting needed. Select mainnet
by pointing the client's `PAY_TARGETS` and the server's payout addresses
(`EVM_ADDRESS` / `TRON_ADDRESS`) at mainnet, and set a reliable `EVM_RPC_URL`
for BSC. ⚠️ **REAL FUNDS.** All verified on-chain; sources: the official
[Network & Token Support](https://docs.bankofai.io/x402/core-concepts/network-and-token-support/) docs.

| Network | Token | Address | Dec | Method |
|---|---|---|---|---|
| `eip155:56` (BSC) | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | permit2 |
| `eip155:56` (BSC) | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | permit2 |
| `tron:mainnet` | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 | permit2 |
| `tron:mainnet` | USDD | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` | 18 | permit2 |

> BSC mainnet has **no ERC-3009 token** (USDC/USDT are plain BEP-20) — so
> mainnet EVM payments all go permit2 + gas-sponsored approve. DHLU (eip3009) is
> BSC-testnet-only.

### Adding a chain/token

It's a **config-table edit, not code**:

- **New token on an existing network** — one entry in the server's `EVM_TOKENS`
  (`chains/evm.ts`); client/facilitator are token-agnostic and need no change.
- **New EVM network** — one entry each in `EVM_NETWORKS` (client + facilitator)
  and `EVM_TOKENS` (server), plus the viem chain import (e.g.
  `import { bsc } from "viem/chains"`). The gas-sponsoring extension and signers
  are generic — no wiring changes. No SDK changes.

The per-token method is data in `extra`: ERC-3009 token → `{ name, version }`
(eip3009); plain ERC-20 → `{ assetTransferMethod: "permit2" }`. Determine it by
the token's on-chain ERC-3009 support (or the docs above).

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

Env is **split by business scenario** — one self-contained file per line, so the
four lines run side by side and you only fill in what you run:

| Scenario | Template → fill | Loaded by |
|---|---|---|
| exact (main) | `.env-exact.example` → `.env-exact` | `clients/fetch`, `servers/express`, `facilitator/basic`, `clients/mcp`, `servers/mcp` |
| gasfree | `.env-gasfree.example` → `.env-gasfree` | `clients/gasfree`, `servers/gasfree`, `facilitator/gasfree` |
| batch-settlement | `.env-batch.example` → `.env-batch` | `clients/batch-settlement`, `servers/batch-settlement`, `facilitator/batch-settlement` |
| upto | `.env-upto.example` → `.env-upto` | `clients/upto`, `servers/upto`, `facilitator/upto` |

```bash
pnpm install               # links the in-repo SDK packages (see pnpm-workspace.yaml)
cp .env-exact.example .env-exact   # then fill it in

pnpm dev:facilitator   # terminal 1  (:4022)
pnpm dev:server        # terminal 2  (:4021)
pnpm dev:client        # terminal 3
```

Configure the wallet via agent-wallet — a single `AGENT_WALLET_PRIVATE_KEY`
serves both chains — and set the server's payout addresses
(`EVM_ADDRESS` / `TRON_ADDRESS`). See each `.env-<scenario>.example`.

## Logging / Observability

Every `@bankofai/x402-*` package writes its logs through **one process-global
logger** exported from `@bankofai/x402-core`. By default it writes to `console`
(so doing nothing keeps the current behavior). Call `setLogger(...)` **once** at
startup to redirect all SDK output — across core, mechanisms, http middleware,
and extensions — to a file, `pino`/`winston`, or nowhere. No per-call wiring and
no change to any SDK function signature.

```ts
import { setLogger, noopLogger, type Logger } from "@bankofai/x402-core";

// Logger is console-shaped: debug / info / warn / error, variadic args.
setLogger(myFileLogger);     // capture all SDK logs
// setLogger(noopLogger);    // or silence the SDK entirely
```

| Example | What it shows | Run |
|---|---|---|
| [`logging`](logging) | redirect all SDK logs to `x402.log`; then silence | `pnpm dev:logging` |

The example is keyless/offline — it triggers a real SDK log path and writes the
output to `./x402.log`. See [`logging/README.md`](logging/README.md) for `pino` /
`winston` adapters.

## Relationship to `tests/integrations`

These examples are **onboarding templates**, not tests — no assertions, run by
hand. The protocol-correctness coverage (assertions, scheme×network matrix,
CI-gated) lives in each mechanism package's `test/integrations/`.
