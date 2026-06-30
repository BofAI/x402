# TypeScript conventions (x402)

Target: **Node 20+**. `pnpm >= 11` workspace + `turbo` build graph. All packages ESM-only, published as `@bankofai/x402-*`. See [typescript/CLAUDE.md](../../../typescript/CLAUDE.md) for build/test commands and the full fork/scheme rules — this sheet is the convention floor.

## Tooling

- **Package manager**: `pnpm` (workspace at `typescript/pnpm-workspace.yaml`). No `npm` / `yarn` lockfiles.
- **Build**: `turbo run build` per package → `dist/` (**gitignored**). The `examples/` workspace links these packages and builds from source — rebuild after changing SDK source. Don't import from `dist/` in source or tests.
- **Tests**: `vitest`. Unit in `packages/*/test/unit` (`pnpm test`, offline). Integration in `packages/*/test/integrations/*.nile.test.ts` (real chains, self-skip). See [testing/conventions.md](../testing/conventions.md).
- **tsconfig**: extend `tsconfig.base.json`. Do not disable `strict`, `noUncheckedIndexedAccess`, or `noImplicitOverride`.

## Idioms

- **`"type": "module"` everywhere**. Explicit `.js` suffixes on relative imports (Node ESM resolution).
- **No default exports** in public API packages. Named exports only.
- **`BigInt`** for all amounts. `number` only for chainIds, timestamps, loop counters. Serialize with `.toString()` — never re-encode through `Number`.
- **Typed data via `viem`** (EVM) and the in-tree TIP-712 signer (`mechanisms/tron`). Convert TRON Base58 → 0x-hex with `tronAddressToEvm` / `normalizeAddressForSigning` **before** any typed-data signing.
- **Errors**: `X402Error` subclasses; preserve facilitator error codes as discriminants.
- **No `any`** — prefer `unknown` + narrowing. **No `require()`**. **No `console.log` in library code** — accept a logger via options or return data.

## Package structure

Consumers import granular packages directly — there is **no umbrella `@bankofai/x402` package**.

- `core` (`@bankofai/x402-core`) — protocol types, client/server/facilitator orchestration, http resource server, chain-agnostic `Wallet` contracts.
- `mechanisms/{evm,tron}` — per-chain schemes; one workspace package per chain family. **Mechanisms must not cross-import** (`evm` ⊄ `tron`); shared types go in `core`.
- `extensions` — payload extensions (gas-sponsoring, offer-receipt, sign-in-with-x).
- `http/{fetch,express,fastify,hono,next,axios}`, `mcp` — transports.
- `packages/legacy`, `packages/x402-deprecated` — **frozen** back-compat. Do not add new code there.

## Upstream fork — the load-bearing rule

`core` and `mechanisms/evm` are **forked from `x402-foundation/x402`**. Keep them **byte-identical to upstream modulo the `@x402/* → @bankofai/x402-*` rename**.

- **Put BankofAI additions in NEW overlay files; never edit upstream files.** Overlays live in `core/src/wallets/`, `mechanisms/evm/src/adapters/`, etc.
- Before changing an upstream-derived file (`signer.ts`, `exact/**`, `upto/**`, `shared/permit2.ts`, …) ask whether it belongs in an overlay. A bug that "looks upstream" is usually the **overlay wiring** — fix it there.
- `mechanisms/tron` has **no upstream** — owned here; edit directly.

## Signer factories (adapter layer)

Wallet → signer adaptation lives in the overlay, not upstream `signer.ts`. Convention:
**`create<Role><Chain>Signer(wallet, { network, rpcUrl?, apiKey? })`** — Role ∈ {Client, Facilitator, Authorizer}, Chain ∈ {Evm, Tron}. The factory builds the chain client internally from the CAIP-2 `network`; callers pass a structural `Wallet`, not a chain client. Unit-test by mocking the client builder (`createEvmPublicClient` / `buildTronWeb`), not by injecting a chain client.

## Don'ts

- **No default exports in public packages.** **No `any`.** **No `require()`.** **No `console.log` in library code.**
- **No cross-mechanism imports.** **No editing upstream-forked files** when an overlay will do.
- **No thin pass-through `register<Scheme>` helpers** — use `new + register`.
