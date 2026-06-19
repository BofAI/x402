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

## Supported chains & tokens

| Chain | Network | Token | Scheme | One-time approve | User pays gas? |
|---|---|---|---|---|---|
| TRON nile | `tron:nile` | USDT (6) | exact **permit2** | yes — client auto-broadcasts | only the approve (TRX) |
| TRON nile | `tron:nile` | USDD (18) | exact **permit2** | yes — client auto-broadcasts | only the approve (TRX) |
| BSC testnet | `eip155:97` | DHLU (6) | exact **eip3009** | none | **none (fully gasless)** |
| BSC testnet | `eip155:97` | USDC (18) | exact **permit2 + gas-sponsoring** | yes — client signs, facilitator relays | only the approve (BNB) |

How each token settles on-chain:

- **DHLU — eip3009 (best):** the client signs `transferWithAuthorization`
  (EIP-712, domain `("DA HULU","1")`); the facilitator submits it. No approve,
  user pays no gas. Use this whenever a token implements ERC-3009.
- **TRON USDT/USDD — permit2:** the client signs a Permit2 witness permit
  (TIP-712). On first use the client **auto-broadcasts** the one-time
  `approve(Permit2)` (`ensureAllowance`, ~3s); the facilitator settles via
  `x402Permit2Proxy.settle`. TRON has no gas delegation, so that approve costs
  the user a little TRX.
- **BSC USDC — permit2 + gas-sponsoring:** USDC is a plain BEP-20 (no
  ERC-3009 / no EIP-2612), so it needs an on-chain `approve(Permit2)`. The
  client signs that approve **offline**; the facilitator broadcasts it bundled
  with settle (the `erc20ApprovalGasSponsoring` extension). This removes the
  separate manual approve step — but the approve's `from` is the user, so on a
  basic EOA facilitator the user still pays its BNB (true gasless needs an
  AA/paymaster facilitator).

Approve broadcasting differs by chain on purpose: TRON has no
authorizer/fee-payer split, so the **client** broadcasts it; EVM can decouple
them, so the **facilitator** relays it (leaving the door open to real
sponsorship).

### Mainnet (commented-ready, real funds)

Production tokens are pre-listed as **commented** entries in the same tables, so
enabling them is config-only — no logic changes (see "Adding a chain/token"
below). All verified on-chain; sources: the official
[Network & Token Support](https://docs.bankofai.io/x402/core-concepts/network-and-token-support/) docs.

| Network | Token | Address | Dec | Method |
|---|---|---|---|---|
| `eip155:56` (BSC) | USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | 18 | permit2 |
| `eip155:56` (BSC) | USDT | `0x55d398326f99059fF775485246999027B3197955` | 18 | permit2 |
| `eip155:56` (BSC) | EPS | `0xA7f552078dcC247C2684336020c03648500C6d9F` | 18 | permit2 |
| `tron:mainnet` | USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 | permit2 |
| `tron:mainnet` | USDD | `TXDk8mbtRbXeYuMNS83CfKPaYYT8XWv9Hz` | 18 | permit2 |

> BSC mainnet has **no ERC-3009 token** (USDC/USDT/EPS are all plain BEP-20) — so
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
