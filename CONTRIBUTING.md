# Contributing to x402

First off, thank you for considering contributing to x402! It's people like you who make x402 such a great tool.

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct. We expect all contributors to maintain a professional and respectful environment.

## How Can I Contribute?

### Reporting Bugs

- Use a clear and descriptive title for the issue to identify the problem.
- Describe the exact steps which reproduce the problem in as many details as possible.
- Provide specific examples to demonstrate the steps.
- Describe the behavior you observed after following the steps and point out what exactly is the problem with that behavior.
- Explain which behavior you expected to see instead and why.

### Suggesting Enhancements

- Use a clear and descriptive title for the issue to identify the suggestion.
- Provide a step-by-step description of the suggested enhancement in as many details as possible.
- Explain why this enhancement would be useful to most x402 users.

### Pull Requests

- Fill in the required template (if available).
- Do not include more than one fix/feature per pull request.
- Ensure that the tests pass and the code adheres to the project's coding standards.
- Update the documentation if you've made changes to the API or added new features.
- Commit messages follow `<type>(<scope>): <description>` (see [.claude/rules/common/conventions.md](.claude/rules/common/conventions.md)).

---

## Development Setup

### Prerequisites

- **Node.js**: 20+
- **pnpm**: >= 11 (workspace package manager)
- **A wallet**: a TRON wallet with TRX (Nile/Shasta testnets) and/or a BSC wallet with BNB, for gas.

### Repository Structure

- **SDK**: [`typescript/`](typescript/CLAUDE.md) — pnpm/turbo monorepo, packages published as `@bankofai/x402-*` (`core`, `mechanisms/{evm,tron}`, `extensions`, `http/*`, `mcp`).
- **Examples**: [`examples/typescript/`](examples/typescript/) — runnable client/server/facilitator trios per scheme.
- **Agent rules & reviewers**: [`.claude/`](.claude/rules/CLAUDE.md) — conventions and specialized review subagents.
- **Legacy**: [`legacy/`](legacy/) — previous-generation Python + TypeScript SDK, reference-only and **slated for removal**. Don't build on it.

---

## TypeScript Development

### Setup

```bash
cd typescript
pnpm install
```

### Commands

```bash
pnpm build                 # turbo run build (all packages → dist/, gitignored)
pnpm test                  # vitest unit tests (offline, no secrets)
pnpm test:integration      # real-chain tests; self-skip without .env creds
pnpm lint:check            # turbo run lint:check

# single package
pnpm --filter @bankofai/x402-evm build
pnpm --filter @bankofai/x402-evm test
```

After changing SDK source, **rebuild** before the `examples/` workspace (which links the packages) picks it up.

### Upstream fork — read before editing `core` or `mechanisms/evm`

`core` and `mechanisms/evm` are **forked from `x402-foundation/x402`** and kept byte-identical to upstream modulo the `@x402/* → @bankofai/x402-*` rename. Put BankofAI additions in **new overlay files** (`core/src/wallets/`, `mechanisms/evm/src/adapters/`, …) — don't edit upstream files. `mechanisms/tron` is in-house; edit it directly. Full rules in [typescript/CLAUDE.md](typescript/CLAUDE.md).

### Coding Standards

- **ESM-only**: `"type": "module"`, always include the `.js` extension on relative imports.
- **No default exports** in public packages; **no `any`** (prefer `unknown` + narrowing).
- **`BigInt`** for all token amounts; serialize with `.toString()`, never via `Number`.
- **Naming**: `camelCase` for files/variables/methods, `PascalCase` for classes and interfaces. Scheme classes are `<Scheme><Chain>Scheme`, same name across roles (role = import subpath).
- **No `console.log`** in library code — accept a logger via options or return data.
- `tsconfig` extends `tsconfig.base.json`; don't relax `strict` / `noUncheckedIndexedAccess`.

---

## Testing Guidelines

1. **Vitest**, co-located under `packages/*/test/`. Unit tests (`test/unit/**`, run by `pnpm test`) must pass **offline with no secrets** — mock the chain client builder, never hit a real node. Integration tests (`test/integrations/*.nile.test.ts`) self-skip when `.env` creds are absent.
2. **Write a reproduction test first** when fixing a bug.
3. **Never print or log private keys or secrets** in test output.

## Security

- **Secrets**: Never commit `.env` files or hardcode secrets.
- **Logging**: Sanitize logs. Do not log raw private keys or sensitive payloads.
- **Payment-path changes** (signing, settlement, header encoding) should route through the `security-reviewer` subagent.
- **Vulnerabilities**: If you find a security vulnerability, please do not open a public issue. Instead, contact the maintainers directly.

## License

By contributing, you agree that your contributions will be licensed under its [MIT License](./LICENSE).

