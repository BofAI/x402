# TRON Official SDK Migration M1 Validation Record

Date: 2026-10-15 (Asia/Shanghai). Branch: `feat/tron-official-sdk`. Baseline: `e50e9f09149203a97e35110ee1cd64073487f30d` on `origin/develop`.

## Deliverables

- Four TRON payment schemes use public types and runtime instances from official `@x402/core@2.28.0`.
- Official Core is an exact peer/dev dependency, externalized from build artifacts; basic consumers install neither legacy Core nor Agent Wallet.
- Signing interfaces, wallet wrappers, transaction construction, signature normalization, broadcast, and receipt handling are maintained separately.
- Signature-only payments require RPC capabilities according to their path; wallet factories preserve guaranteed RPC capabilities and existing call shapes.
- Structural wallet types and logging interfaces moved into TRON; `/exact/extensions` exposes the public contract.
- Migration documentation, a major Changeset, and independent consumer CI were added.

## Validation results

Commands ran in the worktree's `typescript/` directory using pnpm 11.1.1:

| Command                                               | Result                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @bankofai/x402-tron test`              | 31 files, 312 tests passed                                            |
| `pnpm --filter @bankofai/x402-tron exec tsc --noEmit` | Passed                                                                |
| `pnpm --filter @bankofai/x402-tron build`             | ESM, CJS, and declarations passed                                     |
| `pnpm --filter @bankofai/x402-tron lint:check`        | Passed                                                                |
| `pnpm --filter @bankofai/x402-tron format:check`      | Passed                                                                |
| `pnpm --filter @bankofai/x402-tron test:consumer`     | Strict NodeNext ESM/CJS, basic payment, and all 18 entrypoints passed |
| `git diff --check`                                    | Passed                                                                |

Independent consumers used TypeScript 5.7.3, `strict: true`, and `skipLibCheck: false`. Source validation used TypeScript 5.9.2. Runtime: Node.js 25.6.0, locally installed TronWeb 6.3.0 and Agent Wallet 2.4.0. CI is configured for Node.js 22.

Tests cover real official Core registration, payload creation, verify/settle, and extension context dispatch; GasFree, batch deposits, off-chain voucher debits, pending, cancellation, concurrency rejection, corrected responses, refunds, and stored-state recovery after rebuilding clients and servers. Real Agent Wallet local isolated tests cover Permit2 signing, initial approve, transaction JSON/recovery-bit normalization, settlement permissions, and Approval pre-signing.

The original baseline passed 26 files and 290 tests after building legacy Core. Logs include intentional RPC fallback messages and Node.js 25 warnings about the existing ESLint configuration's module format; these did not affect check exit status.

## Independent review and fixes

Independent review of `e50e9f09..fd680826` found two P2 issues:

1. Wallet factory return types made `readContract` optional along with the minimal Signer, breaking existing strict consumers. ESM/CJS compilation reproduced failure; adding `ClientTronSignerWithRpc` return types and composition overloads made it pass.
2. CommonJS entrypoints each held separate logging state, so root `setLogger` could not control GasFree subpath logs. A packed consumer reproduced the missing custom sink output; shared CJS chunks fixed it.

Additional state-recovery tests suggested by review were added. The reviewed changes passed all checks above; a second independent review round was not scheduled.

## Scope not yet accepted

M2 independent resource extension extraction, M3 external service migration/live testnet execution, and M4 legacy package retirement had not been implemented at this stage. Chain state and relayer execution used isolated test services. Passing tests does not establish live chain execution, production providers, persistent coordinators, or cross-service recovery acceptance. The entire monorepo suite was not run, and no candidate was merged, pushed, or published.
