# TRON Resource Sponsorship Extension Package M2 Implementation Plan

> Execute tasks in the current worktree with superpowers:executing-plans, following the previously approved design and the session's execution approach.

**Goal:** Separate the publication boundaries of `@bankofai/x402-tron` and `@bankofai/x402-tron-extensions`, composing resource sponsorship through official Core 2.28.0 hooks/context.

**Design basis:** M2 in https://github.com/boboliu-1010/tron-x402-docs/blob/main/README.md; continuation was explicitly requested.

**Constraints:** Preserve payment messages, signatures, and resource safety validation. The mechanism must not depend on the extension; the extension uses only public mechanism entrypoints and official Core. No live chain transactions, external service migration, or publication.

## Task 1: Package structure and business logic migration

- [x] Record existing TRON and generic extension test baselines.
- [x] Move the generic extension package to `packages/legacy/extensions`, preserving package name, workspace membership, and callers; fix relative configuration/test paths.
- [x] Convert `packages/extensions` to `@bankofai/x402-tron-extensions`, with exact official Core 2.28.0 and public mechanism API dependencies.
- [x] Move resource runtime, coordinator, policies, resource chain adapters, declarations, schemas, and dedicated Approval validation into the new package's `src/trc20-approval-resource-sponsoring/`.
- [x] Move corresponding tests, remove resource business exports from the mechanism root, and add necessary generic `/rpc` and `/transactions` entrypoints.
- [x] Commit after type/build validation.

## Task 2: Official client hooks and mechanism contract

- [x] Add failing tests for declared but unregistered client extensions, sufficient allowance, insufficient allowance requiring pre-signing, missing capabilities, concurrency, and actual batch deposit amounts.
- [x] Keep only declaration/local preparation marker parsing in the mechanism. The extension's before hook validates version/network, enrichment marks preparation, and the mechanism's post-hook rejects unregistered paths.
- [x] Read the final authorization amount and pre-sign Approval during extension enrichment. After Core's final merge, the after hook removes unused declarations for existing allowance and self-funded fallback paths.
- [x] Invoke registered extension verification/execution through FacilitatorContext; keep dedicated signature checks and resource workflows in the extension.
- [x] Commit after testing actual official Core ordering, all three Permit2 paths, and basic payments.

## Task 3: Packed consumers, regressions, and documentation

- [x] Install both tarballs in an independent project; verify the basic package needs neither extension nor wallet, and full composition uses only official Core.
- [x] Use strict ESM/CJS compilation and runtime checks for all entrypoints, real isolated Agent Wallet signing, resource enable/disable, permission/budget rejection, failure reclamation, and pending retention.
- [x] Add CI, Changeset, migration documentation, and validation records (originally in Chinese); run appropriate TRON, new extension, and transitional generic extension checks.
- [x] Independently review the entire M2 commit range; reproduce important findings before fixing.

## Review focus

- Client hooks must prevent self-funded approve before handling the final authorization amount; batch route prices must not be treated as deposit amounts.
- Sufficient allowance must not leave unused declarations in the final payment payload, and reused server declaration data must not be mutated.
- Missing registration/capabilities and invalid fields must reject explicitly. Forged declarations must not bypass allowance checks.
- Preserve network, owner, receiver, permission, budget, complete transaction binding, and pending resource retention/reclamation behavior.
- No reverse dependency from mechanism to extension. ESM/CJS entrypoints must keep the same contracts, without resource business implementations in the published mechanism.

## Execution results

Implementation commit: `9acbd732abdc3ad9e74f6b7b0d7d0119bd3d15f0`. Mechanism 224 tests, new extension 101 tests, and transitional generic extension 532 tests passed. Types, build, lint, format, and strict independent ESM/CJS packed consumer checks passed. Independent review found no issue requiring a fix. Scope and limitations: [M2 validation record](2026-10-15-tron-official-sdk-m2-validation.md).
