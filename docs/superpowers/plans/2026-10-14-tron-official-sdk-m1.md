# TRON official SDK M1 implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the current session.

**Goal:** Run all four existing TRON payment mechanisms against official Core without a runtime dependency on BankofAI Core or Agent Wallet.

**Architecture:** Depend on official `@x402/core` public exports. Keep TRON payment messages and public role entrypoints; separate structural signer contracts, wallet adapters and transaction utilities. Preserve resource-sponsoring integration contracts for the M2 extraction.

**Tech Stack:** TypeScript, pnpm 11.1.1, tsup, Vitest, TronWeb, `@x402/core` 2.28.0.

**Spec:** https://github.com/boboliu-1010/tron-x402-docs/blob/main/README.md (2026-10-14, M1).

## Global constraints

- Branch: `feat/tron-official-sdk`, based on `origin/develop` at `e50e9f09149203a97e35110ee1cd64073487f30d`.
- Worktree: `/Users/bobo/code/x402/x402-tron-official-sdk`; original checkout and its uncommitted documents remain untouched.
- Pin official Core peer and dev dependencies to exactly `2.28.0`; externalize Core from bundles and declarations.
- Preserve `exact`, `upto`, `batch-settlement`, `exact_gasfree`, their three roles, and existing payment message behavior.
- Preserve `createClientTronSigner(wallet, …)` and `createFacilitatorTronSigner(wallet, …)` compatibility.
- Agent Wallet remains a development/test dependency; applications choose their signing implementation.
- Import official types only through package public exports. Do not patch or vendor official Core.
- M2 extracts the resource extension; M3 migrates services; M4 retires old packages after consumer acceptance. CLI and recharge server are excluded.

## Review focus

- Typed-data-only signers must pay through paths that do not require RPC or transaction signing.
- A pre-approved Permit2 wallet without transaction signing must work; insufficient allowance must fail clearly when automatic approval is unavailable.
- Wallet adapters must preserve method binding, signature prefix/recovery normalization, serialized transaction parsing, network, fee and permission options.
- Batch pending, cancellation, corrective response, refund and storage restoration must retain behavior through actual official Core lifecycle dispatch.
- Packed consumers must resolve every public role entrypoint with strict ESM and CJS types without old Core or Agent Wallet installed.

## Verified discovery

- SDK package resides at `typescript/packages/mechanisms/tron`; no AGENTS.md found within this checkout.
- Published npm tarball for Core 2.28.0 was downloaded and inspected independently of local prototypes.
- Its public types include `SchemeClientHooks`, `SchemeServerHooks`, `PaymentFlowConfig`, `SchemePaymentRequiredContext`, `DeepReadonly`, and facilitator extension context.
- Wallet contracts and logger are BankofAI-only modules and must move into the TRON package.
- Installed default pnpm is 10.7.0; use the repository's pinned 11.1.1 runtime for lockfile updates.
- No baseline tests have run yet; workspace installation and baseline verification precede product changes.

## Task 1: Record a reproducible baseline and official composition tests

**Files:** `typescript/packages/mechanisms/tron/test/unit/official-core.test.ts` (new), `typescript/packages/mechanisms/tron/package.json`, `typescript/pnpm-lock.yaml`.

**Interfaces:** Consume real `x402Client`, `x402ResourceServer`, `x402Facilitator` from official public entrypoints. Exercise existing TRON role constructors and deterministic test signers.

- [x] Install the existing frozen workspace with pnpm 11.1.1 and run `pnpm --filter @bankofai/x402-tron test` before changes. Record any pre-existing failures by name.
- [x] Add official Core 2.28.0 as a test development dependency and update the lockfile using pnpm 11.1.1.
- [x] Add composition tests for all four schemes: real Core registration, supported kinds, payload creation and verification/settlement with injected chain responses. Assert unchanged scheme, accepted requirements, authorization fields and settlement outcomes.
- [x] Add an independent-consumer test that imports built public entrypoints while old Core is unavailable; run it to expose the current dependency failure.
- [x] Run the focused tests and capture failures before changing production imports. Type checks are also expected to expose any official contract mismatches.

## Task 2: Own wallet contracts and logging inside the TRON package

**Files:** `src/wallets.ts`, `src/logger.ts` (new); `src/signer.ts`, `src/rpc.ts`, `src/gasfree/client/scheme.ts`, `src/shared/gasfree/api.ts`, `src/index.ts` (under the TRON package); `test/unit/signer-wallet.test.ts`, `test/unit/facilitator-wallet.test.ts`, `test/unit/logger.test.ts`.

**Interfaces:** Export structural `Wallet`, `ClientWallet`, `FacilitatorWallet<TTx>` with existing signatures. Export `Logger`, `log`, `setLogger`, `resetLogger`, `consoleLogger`, `noopLogger` from TRON; official Core supplies none of these application-specific APIs.

- [x] Add a failing logger test: importing `log` before `setLogger` still directs later messages to the chosen sink; resetting restores console behavior.
- [x] Retain wallet signature and transaction regression cases, including method binding and prefix/recovery normalization.
- [x] Move structural wallet contracts and logger into TRON, preserving behavior and attribution; update internal imports and public exports.
- [x] Run logger and wallet tests, then the complete TRON unit suite; commit this self-contained removal of private Core APIs.

## Task 3: Separate signer contracts, wallet adapters and transaction utilities

**Files:** `src/signer.ts`, `src/adapters/wallet.ts` (new), `src/transactions/{index,signatures}.ts` (new); existing signer/allowance tests and `test/unit/signer-capabilities.test.ts` (new).

**Interfaces:** Preserve factory call signatures and exported normalization helpers through re-exports. Payment schemes consume structural signer capabilities. Wallet-specific implementations live in adapters; transaction parsing and signature normalization live in transactions.

- [x] Add failing tests for a signer implementing only `address` and `signTypedData` on the exact authorization path; assert no chain operation is required.
- [x] Add capability tests for pre-approved Permit2, insufficient allowance without transaction signing, explicit network mismatch, and resource pre-signing without required capabilities. Assert clear errors and no broadcast on rejected input.
- [x] Move implementations by responsibility, preserving existing wallet factory signatures and bindings. Make RPC capability optional only where supported paths do not need it; guard every affected read and approval path with meaningful errors.
- [x] Run signer, allowance, sponsorship validation, GasFree and batch signature tests, followed by the full TRON suite; commit.

## Task 4: Migrate four mechanisms to official public contracts

**Files:** TRON `src/{exact,upto,batch-settlement,gasfree,shared}/`, `package.json`, `tsup.config.ts`, `tsconfig.json`, and corresponding tests; `src/exact/extensions.ts` (new public extension-contract entrypoint).

**Interfaces:** Implement official `SchemeNetworkClient`, `SchemeNetworkServer`, `SchemeNetworkFacilitator` and `FacilitatorContext`. Public exact role exports remain `ExactTronScheme` and `registerExactTronScheme`.

- [x] Extend Task 1 tests to drive batch cancellation, pending settlement, corrective payment-required response and refund through official Core. Assert stored state and response fields, not just hook invocation counts.
- [x] Exercise extension-disabled ordinary payment, extension-declared payment without runtime, invalid declaration and valid injected runtime through real official registration and context lookup.
- [x] Replace old Core imports in production and tests with official public exports. Resolve differences without unchecked casts that hide incompatible contracts; preserve token money conversion and message fields.
- [x] Provide `/exact/extensions` with extension key, structural contracts and context helpers for M2; keep existing resource runtime during M1 to avoid a dependency cycle.
- [x] Replace old Core dependency with exact official peer/dev versions. Configure build externals and public exports; regenerate the workspace lockfile.
- [x] Run `pnpm --filter @bankofai/x402-tron exec tsc --noEmit`, package build and complete unit suite; commit.

## Task 5: Prove independent package consumption and document M1

**Files:** `typescript/packages/mechanisms/tron/test/consumer/` (new standalone ESM/CJS fixtures and runner), TRON package scripts, README, and a Changeset.

**Interfaces:** Consume only the packed TRON artifact, `@x402/core@2.28.0`, required TronWeb dependencies and TypeScript tooling. Agent Wallet is installed only in the separate wallet interoperability fixture.

- [x] Pack the artifact, install into temporary independent fixtures, and assert their dependency trees contain neither `@bankofai/x402-core` nor Agent Wallet for basic payments.
- [x] Compile strict NodeNext ESM `.mts` and CommonJS `.cts` fixtures covering root and every role entrypoint, extension contracts, direct signer usage and compatibility factories. Include `@types/node` explicitly.
- [x] Run a deterministic official Core exact payment end to end in both runtime module formats using the packed artifact.
- [x] Run the separate real Agent Wallet interoperability tests, preserving existing wallet API and recording the tested version.
- [x] Add migration examples for direct signers, wallet factories and logging. Document resource extension extraction as pending M2 and real-chain acceptance as pending M3.
- [x] Run full TRON tests, type checking, build, lint and packed consumer verification; review the final diff and record remaining failures or limitations accurately.

## Handoff

M1 is complete only after all four mechanisms build and pass official Core composition tests and independent packed consumption. Testnet execution, service migration, persistent coordinator recovery and old package retirement remain tracked under M2–M4 and must not be presented as accepted by M1 unit tests.


## Execution result — 2026-10-15

M1 implemented and verified. See `docs/superpowers/plans/2026-10-15-tron-official-sdk-m1-validation.md` for evidence and limitations.
Independent review found two P2 compatibility regressions (factory RPC return typing and cross-entrypoint CJS logger state); both were reproduced by failing packed-consumer tests and fixed. Storage restoration coverage now recreates client/server objects over cloned saved state through official Core dispatch.
