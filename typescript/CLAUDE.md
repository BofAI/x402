# typescript/

TypeScript monorepo (`pnpm` workspace). Targets Node 20+. Published as `@bankofai/*` scoped packages.

## Build & test

```bash
# from typescript/
pnpm install
pnpm -r build           # all packages
pnpm -r test            # all packages (vitest)
pnpm -r --if-present lint
pnpm -C packages/x402 test           # single package
pnpm -C packages/x402 test -- --reporter=verbose config.test
```

Node: **>=20**. pnpm: **>=10** (see root `package.json` engines).

## Workspace layout

| Package | Purpose |
|---|---|
| `packages/x402` | Public SDK entry. Re-exports from `mechanisms`, `http`, etc. Consumer-facing. |
| `packages/core` | Prebuilt tsbuildinfo / shared types (currently `dist`-only). |
| `packages/mechanisms/evm` | EVM mechanisms (`exact`, `exact_permit`). |
| `packages/mechanisms/tron` | TRON mechanisms (`exact`, `exact_permit`, `exact_gasfree`). |
| `packages/mechanisms/{svm,aptos,stellar}` | Non-EVM scaffolds (no production use yet). |
| `packages/extensions` | Legacy / non-core payload extensions. |
| `packages/http` | Fetch middleware + framework adapters (Express/Hono planned — see design doc). |
| `packages/mcp` | MCP transport — currently stub; P2 in [design](../docs/design/ai-transformation.md). |
| `packages/legacy`, `packages/x402-deprecated` | Old entry points kept for backward compat. **Do not add new code here.** |

## Conventions

- **ESM-only.** `"type": "module"` everywhere. No CJS shims.
- **`viem` for EVM** signing / encoding. **`tronweb` for TRON** transactions; **custom TIP-712 signer** in `packages/mechanisms/tron/src/` (do not pull a new lib).
- **Address normalization**: lowercase via `viem`'s `getAddress` only where checksumming is required by the *verifier*. Otherwise lowercase string compare. TRON Base58 → hex via `packages/mechanisms/tron/src/utils.ts::addressToHex` before any typed-data signing.
- **BigInt** for all amounts. Never `number`. Serialization helpers live in `packages/x402/src/utils/`.
- **Errors**: `X402Error` subclasses from `packages/x402/src/errors.ts`. No bare `throw new Error(...)` in the pay path.
- **Tests**: `vitest`, co-located `*.test.ts` in `src/`. Snapshot only for stable wire formats (e.g. `config.test.ts`).
- **No default exports** in public API packages — named only.
- **tsconfig**: extend `tsconfig.base.json`. Don't override `strict`.

## Publishing

Each package is independently versioned. `@bankofai/x402` is the documented entry for end users; other packages are primarily internal but are published in case consumers want granular deps.

## Security-critical modules

Signing, facilitator settlement, header encoding — route changes through the `security-reviewer` subagent:

- `packages/mechanisms/*/src/**` — anywhere you touch `signTypedData` or on-chain calls
- `packages/x402/src/http/**` — header encode/decode
- `packages/x402/src/signers/**`

See [.claude/agents/security-reviewer.md](../.claude/agents/security-reviewer.md).
