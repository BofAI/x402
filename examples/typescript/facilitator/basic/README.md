# Basic facilitator (EVM + TRON)

A standalone x402 facilitator exposing `/verify`, `/settle`, `/supported`. The
HTTP layer (`src/index.ts`) is **chain-agnostic** and dispatches by the payment's
`network`; each chain's setup lives in its own module under `src/chains/`.

## Wallet model — agent-wallet, never a raw key

The signer factories are **wallet-only**:

- EVM: `createFacilitatorEvmSigner(wallet, { network, rpcUrl })`
- TRON: `createFacilitatorTronSigner(wallet, { network, apiKey })`

The `wallet` comes from `resolveWallet({ network })` in `@bankofai/agent-wallet`,
which loads the secret out-of-band (env / keystore / Privy). **This example never
reads a private key.** The factories build the viem `publicClient` / `TronWeb`
internally and they carry no account — they only do chain reads and broadcast.

A chain registers only if its wallet resolves, so you can run EVM-only,
TRON-only, or both.

## Run

```bash
# From examples/typescript: cp .env-exact.example .env-exact and fill the wallet.
pnpm install
pnpm dev   # or: pnpm --filter @bankofai/x402-example-facilitator-basic dev
```

Configure the wallet via agent-wallet — a single `AGENT_WALLET_PRIVATE_KEY`
serves both chains (or a keystore dir). See agent-wallet's docs for the full
provider matrix.

## Networks

| Chain | Network | Scheme |
|---|---|---|
| EVM | `eip155:97` (BSC testnet) | `exact` — DHLU via eip3009, USDC via permit2 + gas-sponsored approve |
| TRON | `tron:0xcd8690dc` | `exact` — USDT/USDD via permit2 (auto-approve) |

Add another EVM network (e.g. Base Sepolia) by adding one entry to the
`EVM_NETWORKS` table in `src/chains/evm.ts`. The ERC-20 approval gas-sponsoring
extension is registered once with a per-network signer resolver.
