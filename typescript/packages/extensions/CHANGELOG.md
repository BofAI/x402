# @bankofai/x402-tron-extensions

## 3.0.0-beta.1

- First independent TRON resource-sponsorship package, aligned with `@bankofai/x402-tron@3.0.0-beta.1` and official `@x402/core@2.28.0`.
- Provide client hooks, server declarations, Approval schema/transaction validation, facilitator registration and the resource lifecycle runtime.
- Preserve permission and budget controls, immutable transaction binding, pending-state recovery and resource reclamation.
- Support strict ESM/CJS consumers without a runtime dependency on the old Core, generic extensions or Agent Wallet.
- Beta limitation: services must provide the Resource Owner signing bridge and a durable coordinator; live-chain and production recovery acceptance remain pending.
