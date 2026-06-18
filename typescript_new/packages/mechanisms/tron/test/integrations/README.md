# TRON Nile e2e (integration tests)

Real on-chain end-to-end tests against the **TRON Nile testnet**. They drive the
SDK exactly as production does — signers backed by **`@bankofai/agent-wallet`** —
and actually verify + settle on-chain, asserting balances move.

These are **separate from the unit suite**:

| Suite | Command | Network | Keys |
|---|---|---|---|
| Unit (offline) | `pnpm --filter @bankofai/x402-tron test` | none | none |
| Integration (Nile) | `pnpm --filter @bankofai/x402-tron test:integration` | Nile | required |

`vitest.config.ts` excludes `test/integrations/**`; `vitest.integration.config.ts`
includes only it and runs with `fileParallelism: false` (avoids tx-nonce races).

## Wallet model — agent-wallet, not raw keys in the SDK

The SDK signer factories are **wallet-only** (`createClientTronSigner(tronWeb, wallet)`,
`createFacilitatorTronSigner(tronWeb, wallet)`); they never take a private key.
These tests resolve a real `@bankofai/agent-wallet` wallet and adapt it to the
SDK's `AgentWallet` / `FacilitatorAgentWallet` interfaces (see `helpers.ts`):

```
.env private key ──▶ RawSecretSigner({source:"private_key"}, "tron")   // agent-wallet Wallet
                       ├─ toClientAgentWallet(w)      ──▶ createClientTronSigner(tw, w)
                       └─ toFacilitatorAgentWallet(w) ──▶ createFacilitatorTronSigner(tw, w)
```

`RawSecretSigner` is the `RAW_SECRET` wallet type. In production you'd instead
`resolveWalletProvider({ network: "tron" }).getActiveWallet()` (keystore-backed,
unlocked out-of-band) — same `Wallet` interface, so the adapters are identical.
agent-wallet's `TronSigner.signTransaction` signs the txID directly (no raw_data
re-serialization), so `exact`/permit2 on-chain settlement works through it.

## Setup

1. Copy env and fill it:
   ```bash
   cp test/integrations/.env.example .env        # at the package root
   ```
   - `PAYER_PRIVATE_KEY`, `FACILITATOR_PRIVATE_KEY`, `PAY_TO` (required)
   - `TRON_GRID_API_KEY`, `GASFREE_API_URL` (optional)

2. Fund / provision (Nile testnet):
   - **Payer**: hold Nile USDT (`TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`).
   - **exact / permit2**: payer grants a **one-time Permit2 approval** for USDT
     to the Permit2 contract (`TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h`). Without it the
     settle case **skips**. Facilitator needs TRX/energy to pay for settlement.
   - **exact_gasfree**: payer's **GasFree account activated and funded** with USDT
     (balance covers amount + fee). The relayer pays energy — the payer needs no TRX.

3. Run:
   ```bash
   pnpm --filter @bankofai/x402-tron test:integration
   ```

## What the tests assert

- **`exact-permit2.nile.test.ts`**
  - Server negotiates a `permit2` requirement (`extra.assetTransferMethod`, amount).
  - Full flow: negotiate → client sign (agent-wallet) → facilitator verify → settle.
  - On-chain settlement succeeds and **`payTo` balance increases by the amount**.
  - Skips the settle case when the one-time Permit2 allowance is missing.

- **`exact-gasfree.nile.test.ts`**
  - Full flow against the **live GasFree relayer**: account lookup → client sign →
    verify → submit → poll to a tx hash.
  - Skips when the GasFree account is not activated / underfunded.

## Skip behavior (safe by default)

- **No `.env`** → whole suite skips (`describe.skipIf`). Safe for CI/PRs.
- **Unmet precondition** (no Permit2 approval / inactive GasFree account) → that
  test skips (`ctx.skip()`), not fails.

## Notes

- Use **small amounts** (tests pay `0.1 USDT`) — this is real testnet value.
- Settlement is slow/variable on public nodes; tests use a 180s timeout and an
  API key helps.
- Contract reads are coerced via `toBigInt` to tolerate bigint/string/BN returns
  across tronweb versions; adjust there if a first real run surfaces a new shape.
