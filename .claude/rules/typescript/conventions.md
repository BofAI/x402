# TypeScript conventions (x402)

Target: **Node 20+**. `pnpm >= 10` workspace. All packages ESM-only.

## Tooling

- **Package manager**: `pnpm` (workspace config at `typescript/pnpm-workspace.yaml`). No `npm` / `yarn` lockfiles.
- **Build**: `tsc` per package. Output to `dist/`. Don't import from `dist/` in source or tests.
- **Tests**: `vitest` (`vitest run`). Co-locate `*.test.ts` with source.
- **tsconfig**: extend `tsconfig.base.json`. Do not disable `strict`, `noUncheckedIndexedAccess`, or `noImplicitOverride`.

## Idioms

- **`"type": "module"` everywhere**. Import with explicit `.js` suffixes in relative imports (required by Node ESM resolution).
- **No default exports** in public API packages. Named exports only, so IDE rename and grep stay coherent.
- **`BigInt`** for all amounts. `number` is reserved for chainIds, timestamps (unix seconds fit), and loop counters.
- **Typed data via `viem`**. For TRON, the in-tree TIP-712 signer in `packages/mechanisms/tron/src/` — do not add a new lib.
- **Address normalization**: strings stored lowercase. Checksum only at the boundary of APIs that require it (verifier on-chain). Use `addressToHex` helpers for TRON Base58 → 0x-hex conversion **before** any typed-data signing.
- **Errors**: `X402Error` subclasses from `@bankofai/x402`'s `errors.ts`. Preserve facilitator error codes as discriminants on the subclass.
- **Snapshot tests** only for stable wire formats (`config.test.ts`). Never for log output or stack traces.

## Package boundaries

- `@bankofai/x402` is the consumer-facing entry. Additions to its public surface require a doc update in `specs/` (if wire-format) and a test.
- Mechanisms live in their own workspace package per chain family (`evm`, `tron`, …). Don't cross-import across mechanisms.
- `packages/legacy` and `packages/x402-deprecated` are **frozen** — do not add new code there. Deprecate in a new entry point instead.
- `packages/core` is currently just a `dist` pre-artifact. If you need shared types, put them in `@bankofai/x402/src/types/` and re-export.

## Don'ts

- **No default exports in public packages.**
- **No `any`.** Prefer `unknown` + narrowing.
- **No re-encoding BigInt through `Number`.** Serialize with `.toString()` for JSON.
- **No `require()`** — ESM only.
- **No `console.log` in library code.** Accept a logger via options or return data; let the consumer decide what to log.
