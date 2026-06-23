# typescript_new/

TypeScript monorepo for the BankofAI x402 SDK. `pnpm` (>=11) workspace, `turbo`
build graph, Node 20+, **ESM-only**. Packages publish as `@bankofai/x402-*`.

> Read [.claude/rules/typescript/conventions.md](../.claude/rules/typescript/conventions.md)
> and [.claude/rules/common/conventions.md](../.claude/rules/common/conventions.md) first —
> this file adds the layout, commands, and the non-obvious fork/adapter rules.

## Build & test

```bash
# from typescript_new/
pnpm install
pnpm build                 # turbo run build (all packages → dist/, gitignored)
pnpm test                  # turbo run test  → vitest unit tests only
pnpm test:integration      # core + evm + tron integration tests (real chains)
pnpm lint:check            # turbo run lint:check

# single package
pnpm --filter @bankofai/x402-evm build
pnpm --filter @bankofai/x402-evm test
pnpm --filter @bankofai/x402-evm exec vitest run test/unit/upto   # one suite
```

- **`dist/` is gitignored.** Consumers (and the `examples_new/` workspace, which
  links these packages) build from source via `pnpm build`. After changing SDK
  source you must rebuild before examples pick it up.
- **Unit vs integration**: unit tests live in `packages/*/test/unit` (run by
  `pnpm test`, offline, no secrets). Integration tests in
  `packages/*/test/integrations/*.nile.test.ts` hit real chains, are gated by a
  separate vitest config, and **self-skip** (`describe.skipIf`) when their `.env`
  credentials are absent — never gate CI on them.

## Workspace layout

| Package | npm name | Purpose |
|---|---|---|
| `packages/core` | `@bankofai/x402-core` | Protocol types, client/server/facilitator orchestration, http resource server. **Upstream fork** (see below). |
| `packages/mechanisms/evm` | `@bankofai/x402-evm` | EVM schemes (`exact`, `upto`, `batch-settlement`, `auth-capture`). **Upstream fork.** |
| `packages/mechanisms/tron` | `@bankofai/x402-tron` | TRON schemes (`exact`, `exact_gasfree`, `upto`, `batch-settlement`). **In-house** (no upstream). |
| `packages/extensions` | `@bankofai/x402-extensions` | Payload extensions (gas-sponsoring, offer-receipt, sign-in-with-x). |
| `packages/http/{fetch,express,fastify,hono,next,axios}` | `@bankofai/x402-{fetch,express,…}` | Transport: fetch client + framework middleware. |
| `packages/mcp` | — | MCP transport. |
| `packages/legacy`, `packages/x402-deprecated` | — | Frozen back-compat. **Do not add new code.** |

There is no single umbrella package — consumers import the granular packages
directly (`@bankofai/x402-fetch`, `@bankofai/x402-evm/upto/client`, …).

## Upstream fork — the most important rule

`core` and `mechanisms/evm` are **forked from the `x402-foundation/x402` upstream**
(the `exact`/`upto`/`batch-settlement` schemes, signers, wire format). Keep these
**byte-identical to upstream modulo the `@x402/* → @bankofai/x402-*` rename**, so
pulling a newer upstream stays conflict-free.

- **Put BankofAI additions in NEW overlay files, never edit upstream files.**
  Examples: `core/src/wallets/`, `mechanisms/evm/src/adapters/{agent-wallet,chains}.ts`.
- Before changing an upstream-derived file (`signer.ts`, `exact/**`, `upto/**`,
  `shared/permit2.ts`, …), ask whether the change belongs in an overlay instead.
  When a bug appears to be upstream's, it is usually the **overlay wiring** —
  fix it there (e.g. the facilitator `readContract` must set `account` so the
  upto proxy's caller-authorized `settle` simulation passes).
- `mechanisms/tron` has no upstream — it is fully owned here; edit it directly.

## Signer factories (adapter layer)

Wallet → signer adaptation lives in the overlay, not upstream `signer.ts`:

- EVM: `@bankofai/x402-evm/adapters/agent-wallet` —
  `createClientEvmSigner`, `createFacilitatorEvmSigner`, `createAuthorizerEvmSigner`.
- TRON: `@bankofai/x402-tron` —
  `createClientTronSigner`, `createFacilitatorTronSigner`, `createAuthorizerTronSigner`.

Convention: **`create<Role><Chain>Signer(wallet, { network, rpcUrl?, apiKey? })`**
where Role ∈ {Client, Facilitator, Authorizer}, Chain ∈ {Evm, Tron}. The factory
**builds the chain client internally from the CAIP-2 `network`** (viem
PublicClient / TronWeb) — callers pass a structural wallet, not a chain client.

- Wallet contracts are chain-agnostic and live in `@bankofai/x402-core/wallets`
  (`Wallet` / `ClientWallet` / `FacilitatorWallet<TTx>`). Structural — **no runtime
  coupling to `@bankofai/agent-wallet`** (a keystore/hardware wallet works too).
- Unit-test the factories by mocking the client builder
  (`createEvmPublicClient` / `buildTronWeb`), not by injecting a chain client.
- **Mechanisms must not cross-import** (`evm` ⊄ `tron`); shared types go in `core`.

## Conventions (quick)

- ESM-only, `.js` suffixes on relative imports; **no default exports**; **no `any`**.
- **`BigInt`** for amounts; serialize with `.toString()`, never via `Number`.
- EVM: `viem`. TRON: `tronweb` + the in-tree TIP-712 signer; every address field
  → 0x-hex before signing (TRON Base58 → hex). See common conventions.
- `tsconfig` extends `tsconfig.base.json`; don't relax `strict` /
  `noUncheckedIndexedAccess`.

## Security-critical — route through `security-reviewer`

Signing (EIP-712 / TIP-712), facilitator settlement, Permit2 / GasFree paths,
header encoding. See [.claude/agents/security-reviewer.md](../.claude/agents/security-reviewer.md).
Any change under `mechanisms/*/src/**` that touches `signTypedData`, on-chain
calls, or the simulate/settle path qualifies.
