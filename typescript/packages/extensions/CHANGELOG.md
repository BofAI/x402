# @bankofai/x402-tron-extensions

## 2.1.3

### Patch Changes

- [#120](https://github.com/BofAI/x402/pull/120) [`957d799`](https://github.com/BofAI/x402/commit/957d7996ccfa9ec5eecef5c401cc30d6829c149a) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Upgrade TronWeb to 6.5.2 for stricter validation of node responses and explicit broadcast acknowledgments. Use a Node.js version supported by both packages and TronWeb: Node.js 24.22.1 or later in the 24.x line, or Node.js 26.12.1 or later.

- Updated dependencies [[`957d799`](https://github.com/BofAI/x402/commit/957d7996ccfa9ec5eecef5c401cc30d6829c149a)]:
  - @bankofai/x402-tron@2.1.3

## 2.1.2

### Patch Changes

- [#117](https://github.com/BofAI/x402/pull/117) [`1e17257`](https://github.com/BofAI/x402/commit/1e1725751382f9cb523cf50e0ed05e19a5c14905) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Upgrade TronWeb to 6.5.1 to pick up input snapshotting for signing and contract calls.

  The Axios 1.21.0 and follow-redirects 1.16.2 overrides apply to the repository's pnpm workspaces. SDK consumers resolve TronWeb's HTTP dependencies in their own projects and need their own overrides or an upstream TronWeb release with the patched dependencies.

- Updated dependencies [[`1e17257`](https://github.com/BofAI/x402/commit/1e1725751382f9cb523cf50e0ed05e19a5c14905)]:
  - @bankofai/x402-tron@2.1.2

## 2.1.1

### Patch Changes

- [#112](https://github.com/BofAI/x402/pull/112) [`79ceff8`](https://github.com/BofAI/x402/commit/79ceff860ebd52ad9f5a0e4a82706863f064f90d) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Adopt the official x402 2.29.0 security release using native Zod >=4.6.6. Update official extensions in the HTTP integrations and align the MCP SDK with the official transport's 1.32.0 minimum. Example dependencies and strict packed consumer checks now use the same official versions.

  TRON and TRON resource extensions now require official `@x402/core@2.29.0` as a peer instead of 2.28.0. Upgrade that peer alongside these packages. The official Core `/schemas` export uses Zod 4; applications composing those schemas must also use native Zod 4. Oversized `accepts` arrays are limited to 1,024 entries by the official release.

- Updated dependencies [[`79ceff8`](https://github.com/BofAI/x402/commit/79ceff860ebd52ad9f5a0e4a82706863f064f90d)]:
  - @bankofai/x402-tron@2.1.1

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
