# @bankofai/x402-tron-extensions

## 2.1.0

### Minor Changes

- [#107](https://github.com/BofAI/x402/pull/107) [`319a052`](https://github.com/BofAI/x402/commit/319a052d56ba325ff8b82fce137799ef5587a2f3) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Use official Core 2.28.0 for TRON payments and move resource sponsorship into `@bankofai/x402-tron-extensions`, requiring explicit extension registration.

  Reject failed upto RPC reads, enforce batch/GasFree spend caps, and recover pending settlements using their original transaction or relayer trace without rebroadcasting. Production recovery requires persistent storage with shared locking.

  Remove legacy and local EVM packages. Use official `@x402/evm@2.28.0` and `@x402/extensions@2.28.0` directly for upstream functionality.

  Synchronize shared pending-settlement records across workers, retain batch claims added during settlement, and distinguish execution failures from storage failures. Require Node.js 24.22.1 or newer.

### Patch Changes

- Updated dependencies [[`319a052`](https://github.com/BofAI/x402/commit/319a052d56ba325ff8b82fce137799ef5587a2f3)]:
  - @bankofai/x402-tron@2.1.0

## 2.1.0-beta.3

- Align the exact mechanism dependency with `@bankofai/x402-tron@2.1.0-beta.3`, including pending settlement recovery and original-transaction retries.
- Provide the Nile integration suite, environment template, and documented test entrypoint in this package. Include integration suite discovery in repository CI.

## 2.1.0-beta.2

- Align the exact mechanism dependency with `@bankofai/x402-tron@2.1.0-beta.2`, including fail-closed upto account reads. Resource sponsorship still defers pre-Approval allowance checks while requiring balance checks and post-delegation revalidation.

## 2.1.0-beta.1

- Correct the legacy `module` field to the built `.mjs` entry and verify all package entry fields.
- Align with @bankofai/x402-tron@2.1.0-beta.1; retain official Core 2.28.0 and independent resource-runtime ownership.
- Preserve the earlier 3.0.0-beta.1 release record.

## 3.0.0-beta.1

- First independent TRON resource-sponsorship package, aligned with `@bankofai/x402-tron@3.0.0-beta.1` and official `@x402/core@2.28.0`.
- Provide client hooks, server declarations, Approval schema/transaction validation, facilitator registration and the resource lifecycle runtime.
- Preserve permission and budget controls, immutable transaction binding, pending-state recovery and resource reclamation.
- Support strict ESM/CJS consumers without a runtime dependency on the old Core, generic extensions or Agent Wallet.
- Beta limitation: services must provide the Resource Owner signing bridge and a durable coordinator; live-chain and production recovery acceptance remain pending.
