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
│   │   ├── evm/           # @bankofai/x402-evm - Ethereum/EVM chains
│   │   └── svm/           # @bankofai/x402-svm - Solana
│   ├── http/
│   │   ├── axios/         # @bankofai/x402-axios - Axios interceptor
│   │   ├── express/       # @bankofai/x402-express - Express middleware
│   │   ├── fetch/         # @bankofai/x402-fetch - Fetch wrapper
│   │   ├── hono/          # @bankofai/x402-hono - Hono middleware
│   │   ├── next/          # @bankofai/x402-next - Next.js integration
│   │   └── paywall/       # @bankofai/x402-paywall - Browser paywall UI
│   ├── extensions/        # @bankofai/x402-extensions - Bazaar, Sign-in-with-x
│   └── legacy/            # Legacy v1 packages (deprecated)
├── site/                  # x402.org marketing site
├── turbo.json
└── pnpm-workspace.yaml
```

### Package Dependencies

```
@bankofai/x402-core
    ↑
@bankofai/x402-evm, @bankofai/x402-svm
    ↑
@bankofai/x402-express, @bankofai/x402-hono, @bankofai/x402-next, @bankofai/x402-axios, @bankofai/x402-fetch
```

The core package provides transport-agnostic primitives. Mechanism packages (`evm`, `svm`) implement chain-specific logic. HTTP packages provide framework integrations.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 10.7.0

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
cd packages/mechanisms/evm
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

4. Follow the existing `@bankofai/x402-evm` or `@bankofai/x402-svm` package structure.

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
pnpm --filter @bankofai/x402-evm test

# Watch mode
cd packages/mechanisms/evm
pnpm test:watch
```

### Integration Tests

Integration tests require network access and may use testnets. They also
require test credentials — most suites will skip themselves cleanly when the
required environment variables are not set, so you only need to populate the
subsets you want to exercise.

Create a `.env` at the repository root (or in the specific package you're
testing) with the variables the target suites read. A starting template:

```bash
# --- EVM mechanism (@bankofai/x402-evm) ---
EVM_CLIENT_PRIVATE_KEY=
EVM_FACILITATOR_PRIVATE_KEY=
EVM_RESOURCE_SERVER_ADDRESS=
# Optional: override the RPC endpoint (defaults to Base Sepolia)
# EVM_RPC_URL=https://sepolia.base.org

# --- SVM mechanism (@bankofai/x402-svm) + Stellar ---
CLIENT_PRIVATE_KEY=
FACILITATOR_PRIVATE_KEY=
FACILITATOR_ADDRESS=
RESOURCE_SERVER_ADDRESS=

# --- Aptos mechanism (@bankofai/x402-aptos) ---
APTOS_CLIENT_PRIVATE_KEY=
APTOS_FACILITATOR_PRIVATE_KEY=
```

Each mechanism's `test/integrations/*.test.ts` file is the authoritative
source for the exact variables it consumes — read the one for your target
package to see the complete list.

Run everything or scope to a single package:

```bash
# All packages
pnpm test:integration

# Single package
pnpm --filter @bankofai/x402-evm test:integration
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

