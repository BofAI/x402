# TRON Official SDK Migration M2 Validation Record

Date: 2026-10-15 (Asia/Shanghai). Branch: `feat/tron-official-sdk`. M2 baseline: M1 completion commit `a7f4bb0a`. M2 implementation commit: `9acbd732abdc3ad9e74f6b7b0d7d0119bd3d15f0`.

## Deliverables

- New independent `@bankofai/x402-tron-extensions` package at `typescript/packages/extensions`.
- Resource sponsorship runtime, coordinator, budget/permission policies, resource chain adapters, Approval pre-signing, schemas, and complete transaction validation moved into the new package.
- Dependencies flow from extension to public mechanism entrypoints. The mechanism does not depend on the extension or contain resource sponsorship business logic. Generic `/rpc` and `/transactions` mechanism entrypoints were added.
- Exact Permit2, upto Permit2, and batch deposits compose sponsorship through official Core 2.28.0 client extension hooks, preparing Approval for the final authorization/actual deposit.
- Clients must explicitly register the extension. Network mismatch rejects before signing; missing registration or signing/authorization capabilities fails explicitly. Existing allowance, self-funded fallback, and voucher-only paths remove unused declarations without mutating reused server declarations.
- Facilitators must register verification/execution using the new factory. Legacy `{ key, runtime }` objects require migration. Full schema, signature, transaction binding, and resource safety validation remain in the extension.
- Generic `@bankofai/x402-extensions` remains a transitional workspace package at `typescript/packages/legacy/extensions`. Only two migration-required relative paths changed; business files were unchanged.
- Independent consumer CI, a Changeset, and migration documentation (originally in Chinese) were added. Agent Wallet is for development tests only; production packages depend on neither it nor legacy Core.

## Validation results

Commands ran in the worktree's `typescript/` directory using pnpm 11.1.1 (invoked locally as `npx --yes pnpm@11.1.1`):

| Command                                                                                  | Result                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @bankofai/x402-tron test`                                                 | 26 files, 224 tests passed                                                                                                                                |
| `pnpm --filter @bankofai/x402-tron-extensions test`                                      | 7 files, 101 tests passed                                                                                                                                 |
| `pnpm --filter @bankofai/x402-extensions test`                                           | 10 files, 532 tests passed, matching the pre-migration baseline                                                                                           |
| `pnpm --filter @bankofai/x402-tron exec tsc --noEmit`                                    | Passed                                                                                                                                                    |
| `pnpm --filter @bankofai/x402-tron-extensions exec tsc --noEmit`                         | Passed                                                                                                                                                    |
| `pnpm --filter @bankofai/x402-tron build`                                                | ESM, CJS, and declarations passed                                                                                                                         |
| `pnpm --filter @bankofai/x402-tron-extensions build`                                     | ESM, CJS, and declarations passed                                                                                                                         |
| `pnpm --filter @bankofai/x402-extensions build`                                          | Transitional package build passed                                                                                                                         |
| `pnpm --filter @bankofai/x402-tron --filter @bankofai/x402-tron-extensions lint:check`   | Passed                                                                                                                                                    |
| `pnpm --filter @bankofai/x402-tron --filter @bankofai/x402-tron-extensions format:check` | Passed                                                                                                                                                    |
| `pnpm --filter @bankofai/x402-tron test:consumer`                                        | Strict ESM/CJS compilation, basic payments, and all 20 mechanism entrypoints passed without installing the extension                                      |
| `pnpm --filter @bankofai/x402-tron-extensions test:consumer`                             | Independent installation of both tarballs, strict ESM/CJS, all 25 combined entrypoints, real offline Approval signing, and sponsorship composition passed |
| `git diff --check`                                                                       | Passed                                                                                                                                                    |

Independent consumers used TypeScript 5.7.3, `strict: true`, and `skipLibCheck: false`, verifying no legacy Core, generic extension, or Agent Wallet in artifact dependencies. Source validation used TypeScript 5.9.2. Runtime: Node.js 25.6.0, installed TronWeb 6.3.0, Agent Wallet 2.4.0, and exact official Core 2.28.0. CI uses Node.js 22.

Resource tests cover permission/budget rejection, network/owner/token/spender transaction binding, duplicate coordination, failure reclamation, pending retention, and reconciliation. Client tests cover three Permit2 paths, actual batch deposit amounts, declaration reuse/concurrency, missing RPC/signing capabilities, address normalization, and network checks before signing. Real Agent Wallet signs through isolated adapters; packed consumers use real offline Approval transactions and signatures. Test adapters provide chain state, resource delegation, and settlement execution.

Failures were observed before implementation for unregistered extensions, signing before rejecting wrong networks, and hexadecimal addresses failing the schema; all passed after implementation. Node.js 25 warnings about existing ESLint configuration module format did not affect exit status.

## Independent review

Independent review of `a7f4bb0a..9acbd732` covered all M2 changes and repository-required signature/settlement safety boundaries, finding no correctness or security issue requiring a fix.

The reviewer mechanically checked moved files: only two relative paths changed in the generic transitional package, and moving the resource runtime/Approval validator preserved behavior. The review checked actual Core 2.28.0 hook order, local preparation marker propagation/cleanup, one-way dependencies, and facilitator verification/execution dispatch.

The reviewer independently ran the ESM/CJS real offline signed sponsorship fixture and additional mixed ESM mechanism/CJS extension checks for exact/upto/batch self-funded fallback amounts, missing-capability rejection, existing allowance cleanup, voucher cleanup, marker removal, and declaration immutability. All passed. The reviewer did not repeat the implementation phase's full unit suites or tarball installation checks.

## Subsequent scope

M3 still required migrating external services to the new factories, integrating real resource providers, running live testnet flows, and accepting production persistent coordinators and cross-service recovery. M4 covers generic legacy package retirement and caller migration.

This phase performed no live chain transaction, full-monorepo test run, push, merge, or release. Offline validation does not establish live-chain, resource-provider, or production-recovery acceptance.
