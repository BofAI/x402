# SDK 3.0.0-beta.1 External Service Compatibility Validation

Requested goal: validate complete external service functionality using both published beta packages, checking old/new client/server combinations. Basis: M3 of the approved TRON x402 migration design; real npm artifacts and official Core 2.28.0. Scope: Facilitator, Gateway, Catalog. No CLI/recharge changes, service deployment/publication, or mainnet funds.

## Workspaces and baselines

- Facilitator: `/Users/bobo/code/x402/.worktrees/facilitator-sdk3-beta-compat`, origin/develop `071b517`.
- Gateway: `/Users/bobo/code/x402/.worktrees/gateway-sdk3-beta-compat`, origin/develop `e6cb07b`.
- Catalog: `/Users/bobo/code/x402/.worktrees/catalog-sdk3-beta-compat`, origin/develop `9e87dc1`.
- All three branches: `feature/sdk3-beta-compat`; preserve uncommitted work in original checkouts.

## Validation tasks

- [x] Record original service baselines, install exact npm betas in isolated worktrees, and reproduce failures from direct dependency replacement.
- [x] Migrate Facilitator to official Core and public independent extension entrypoints, preserving wallets, settlement, replay protection, resource permissions, SQLite/PostgreSQL ledgers, and recovery.
- [x] Preserve Gateway provider configuration/HTTP behavior, add optional resource declarations disabled by default, and validate existing EVM/TRON/GasFree/CLI/proxy flows.
- [x] Validate Catalog discovery data against old/new SDK public APIs and HTTP service contracts, without expanding supported schemes.
- [x] Run independent HTTP integration: Catalog discovery, Gateway 402, old/new client signing, Facilitator verify/settle, and upstream responses; cover ordinary payments, sponsorship, errors, pending, and recovery.
- [x] Run service regressions for three TRON mechanisms and GasFree; check SQLite restart, PostgreSQL shared coordination, permissions/budgets, and reclamation boundaries.
- [x] Run available live Nile tests once the environment is specified. Record unaccepted scope precisely if credentials/funds are missing; simulations cannot establish live-chain results.
- [x] Independently review changes and produce validation records (originally in Chinese) and necessary migration documentation. Unit test success does not establish unconditional drop-in or complete production compatibility.

## Interface constraints

Payment wire format and HTTP headers remain v2. Use one Core type/instance family within a call chain. Legacy callers interoperate through serialized messages, not mixed Core objects. Preserve resource schemas, extension keys, Approval transaction binding, original txID recovery, idempotency, and ledger data. Record removed source APIs as failures before required migration. Gateway supports existing exact/exact_gasfree routes only; test upto/batch at Facilitator level without inventing Gateway support.

## Review focus

Old/new message and data recovery compatibility; official hook timing/error codes; wallet signatures/permissions/budgets; duplicate authorization rejection and pending handling; defaults preserving payment behavior; accurate distinction between real-chain and simulated results.
