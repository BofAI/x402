# @bankofai/x402-tron-extensions

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
