# TypeScript SDK Contributing Guide

Guide for developing and contributing to the x402 TypeScript SDK.

## Contents

- [Repository Structure](#repository-structure)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Adding Features](#adding-features)
- [Testing](#testing)
- [Code Quality](#code-quality)

## Repository Structure

The TypeScript SDK is a pnpm workspace managed with Turborepo.

```
typescript/
├── packages/
│   ├── core/              # @bankofai/x402-core - Protocol implementation
│   ├── mechanisms/
│   │   └── tron/          # @bankofai/x402-tron - TRON
│   ├── http/
│   │   ├── axios/         # @bankofai/x402-axios - Axios interceptor
│   │   ├── express/       # @bankofai/x402-express - Express middleware
│   │   ├── fetch/         # @bankofai/x402-fetch - Fetch wrapper
│   │   ├── fastify/       # @bankofai/x402-fastify - Fastify middleware
│   │   ├── hono/          # @bankofai/x402-hono - Hono middleware
│   │   └── next/          # @bankofai/x402-next - Next.js integration
│   └── extensions/        # @bankofai/x402-tron-extensions - TRON resource sponsorship
├── site/                  # x402.org marketing site
├── turbo.json
└── pnpm-workspace.yaml
```

### Package Dependencies

```
@x402/core@2.28.0
    ↑
@bankofai/x402-tron
    ↑
@bankofai/x402-tron-extensions
```

TRON uses official `@x402/core@2.28.0`; its resource sponsorship extension depends on the
TRON mechanism through public entrypoints. Use official `@x402/extensions@2.28.0` directly
for upstream extensions and `@x402/evm@2.28.0` for EVM mechanisms. Local EVM and legacy
v1 packages are not maintained in this repository.

The core package provides transport-agnostic primitives. The local TRON mechanism implements chain-specific logic; EVM comes from upstream. HTTP packages provide framework integrations.

## Development Setup

### Prerequisites

- Node.js >= 22.0.0
- pnpm >= 11.1.1

### Installation

```bash
cd typescript
pnpm install
```

### Build

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @bankofai/x402-core build
```

## Development Workflow

### Watch Mode

For active development, use watch mode in the package you're working on:

```bash
cd packages/core
pnpm test:watch
```

### Common Commands

From the `typescript/` directory:

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all packages |
| `pnpm test` | Run unit tests |
| `pnpm test:integration` | Run integration tests |
| `pnpm lint` | Lint and fix |
| `pnpm lint:check` | Check linting (CI) |
| `pnpm format` | Format code |
| `pnpm format:check` | Check formatting (CI) |

### Working on a Single Package

```bash
cd packages/mechanisms/tron
pnpm build
pnpm test
pnpm test:watch  # Watch mode
```

## Adding Features

### Adding HTTP Middleware

To add a new HTTP framework integration:

1. Create a new package in `packages/http/`:

```bash
mkdir -p packages/http/your-framework
cd packages/http/your-framework
```

2. Create `package.json`:

```json
{
  "name": "@bankofai/x402-your-framework",
  "version": "0.1.0",
  "main": "./dist/cjs/index.js",
  "module": "./dist/esm/index.js",
  "types": "./dist/cjs/index.d.ts",
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint . --ext .ts --fix",
    "lint:check": "eslint . --ext .ts",
    "format": "prettier -c .prettierrc --write \"**/*.{ts,js,cjs,json,md}\"",
    "format:check": "prettier -c .prettierrc --check \"**/*.{ts,js,cjs,json,md}\""
  },
  "dependencies": {
    "@bankofai/x402-core": "workspace:*"
  }
}
```

3. Copy `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, and `eslint.config.js` from an existing HTTP package.

4. Implement the adapter pattern. See `packages/http/express/src/adapter.ts` for reference.

### Adding a New Chain Mechanism

See [New Chains](../CONTRIBUTING.md#new-chains) in the root contributing guide for protocol-level requirements and interface definitions.

To add support for a new blockchain in TypeScript:

1. Create a new package in `packages/mechanisms/`:

```bash
mkdir -p packages/mechanisms/your-chain
```

2. Implement the required interfaces from `@bankofai/x402-core`:
   - `SchemeNetworkClient` - Signs payment payloads
   - `SchemeNetworkServer` - Validates payment requirements
   - `SchemeNetworkFacilitator` - Verifies and settles payments

3. Export registration helpers:

```typescript
// src/exact/client/register.ts
export function registerExactYourChainScheme(
  client: x402Client,
  config: { signer: YourChainSigner; networks?: Network | Network[] }
) {
  const networks = config.networks ?? 'yourchain:*';
  const scheme = new ExactYourChainScheme(config.signer);
  // ... register with client
}
```

4. Follow the local `@bankofai/x402-tron` package structure; use official packages for upstream chains.

### Adding Extensions

Extensions go in `packages/extensions/`. Each extension should:

1. Have its own subdirectory in `src/`
2. Export from the package's main `index.ts`
3. Include a README documenting usage

## Testing

### Unit Tests

```bash
# All packages
pnpm test

# Single package
pnpm --filter @bankofai/x402-tron test

# Watch mode
cd packages/mechanisms/tron
pnpm test:watch
```

### Integration Tests

Integration tests require network access and may use testnets. They also
require test credentials — most suites will skip themselves cleanly when the
required environment variables are not set, so you only need to populate the
subsets you want to exercise.

For TRON Nile setup, follow
[`packages/mechanisms/tron/test/integrations/README.md`](packages/mechanisms/tron/test/integrations/README.md).
Each suite documents its required wallet and RPC configuration. Keep actual credentials outside Git.
The MCP EVM interoperability suite uses official `@x402/evm` and is separate from local mechanism tests.

```bash
pnpm --filter @bankofai/x402-tron test:integration
```

### Test File Organization

```
packages/core/
├── src/
└── test/
    ├── unit/           # Unit tests
    ├── integrations/   # Integration tests
    └── mocks/          # Shared test utilities
```

## Code Quality

### Linting

ESLint with TypeScript rules:

```bash
# Fix issues
pnpm lint

# Check only (for CI)
pnpm lint:check
```

### Formatting

Prettier handles formatting:

```bash
# Format files
pnpm format

# Check formatting (for CI)
pnpm format:check
```

### TypeScript

- Strict mode enabled
- Export types alongside implementations
- Use Zod for runtime validation of external data

## Paywall Changes

The paywall package (`packages/http/paywall/`) contains browser-rendered UI components. See [Paywall Changes](../CONTRIBUTING.md#paywall-changes) in the root contributing guide for build instructions and generated file locations.

## Examples

Examples live in `examples/typescript/`. When adding a new example:

1. Create a directory under the appropriate category
2. Add a `package.json` with the example's dependencies
3. Add a `README.md` with setup and run instructions
4. The example will be included in the workspace automatically via `pnpm-workspace.yaml`

## Changelog

A changeset is required for any change that should be published — this includes code changes, public API or type changes, and documentation updates that affect published packages. To create a changeset, run:

```bash
pnpm changeset
```

Follow the interactive prompts to:
1. Select the packages that should be published.
2. Provide a short, past‑tense summary of the change (for example, "Fixed bug where X failed" or "Added support for Y").
3. Pick the appropriate release type:
   - Patch: Bug fixes, no API changes
   - Minor: New features, backward compatible
   - Major: Breaking changes

When unsure, prefer a patch for fixes and a minor for non‑breaking features; maintainers may adjust bumps during review and release.

## Publishing

Package publishing is handled by maintainers. Version bumps follow semver:

- Patch: Bug fixes, no API changes
- Minor: New features, backward compatible
- Major: Breaking changes

## Getting Help

- Open an issue on GitHub
- Join the discussion in existing issues
- Check the [examples](../examples/typescript/) for usage patterns

