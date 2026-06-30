# x402

This file tells Claude Code how to work in this repository.

## What this is

x402 is an open-source SDK for the **x402 open payment standard** — an HTTP `402 Payment Required` challenge-response protocol for serverless on-chain payments. Three roles participate: **Client** (payer), **Server** (resource provider), **Facilitator** (on-chain settlement).

This repository hosts the BankofAI SDK (Python + TypeScript), the reference facilitator bindings, on-chain mechanisms for TRON and EVM, and the protocol specs.

## Components

Each component has its own `CLAUDE.md` (where present) with build/test commands and conventions.

> The `legacy/` tree holds the previous-generation SDK (Python + old TypeScript + e2e), kept only as reference and **slated for removal**. New work lives in `typescript/` and `examples/`.

| Path | Language | Purpose |
|---|---|---|
| [legacy/python/x402/](legacy/python/x402/) | Python | SDK: client, server (FastAPI/Flask), facilitator, mechanisms (EVM + TRON). |
| [legacy/typescript/](legacy/typescript/) | TypeScript | SDK: fetch client, server middleware, facilitator, mechanisms (EVM + TRON). |
| [legacy/specs/](legacy/specs/) | Markdown | Protocol specs (`protocol.md`, `roles.md`, `config.md`, `schemes/*.md`) + in-flight feature specs (`NNN-<slug>/`). Read **first** when touching wire formats. Mirrors upstream `x402-foundation/x402/specs/` layout. |
| [docs/solutions.md](docs/solutions.md) | Markdown | Hard-won debugging knowledge. **Read before investigating bugs in related areas.** |
| [legacy/examples/](legacy/examples/) | Mixed | Smoke tests and integration examples. |
| [legacy/integration/](legacy/integration/) | Python | Generic step runner used by `legacy/e2e/scenarios/`. |
| [legacy/e2e/](legacy/e2e/) | Python | End-to-end scenarios (mock facilitator + resource server + client). See [legacy/e2e/README.md](legacy/e2e/README.md). Wired into CI via `check_e2e.yml`. |
| [tron-contribution/](tron-contribution/) | Markdown | Upstream contribution planning for `x402-foundation/x402`. |

## Key reading order (new contributor)

1. [legacy/specs/protocol.md](legacy/specs/protocol.md) — wire format, headers, encoding
2. [legacy/specs/roles.md](legacy/specs/roles.md) — Client / Server / Facilitator; **payment selection pipeline** (policy hook at step 5)
3. [legacy/specs/config.md](legacy/specs/config.md) — network + contract registry
4. Scheme spec for the scheme you are touching: [`schemes/exact.md`](legacy/specs/schemes/exact.md) · [`schemes/exact-permit.md`](legacy/specs/schemes/exact-permit.md) · [`schemes/exact-gasfree.md`](legacy/specs/schemes/exact-gasfree.md)
5. [docs/solutions.md](docs/solutions.md) — bug-avoidance checklist (TRON address hex, GasFree deadline bounds, balance source, etc.)

## Conventions

- **Addresses, selectors, event topics**: lowercase-normalized everywhere. TRON addresses are converted to **0x-prefixed EVM hex** before any EIP-712/TIP-712 signing — see [docs/solutions.md entry #1](docs/solutions.md).
- **Payment ID**: 16 random bytes, encoded as `0x` + 32 hex chars, signed as `bytes16`.
- **HTTP header encoding**: `Base64(UTF-8(JSON.stringify(object)))` for `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`.
- **Network identifiers**: CAIP-2 `eip155:<chainId>` for EVM; `tron:<name>` for TRON.
- **Mechanism registration**: `tron:nile` (exact match, higher priority) beats `tron:*` (wildcard, lower priority).
- **Commit messages**: `<type>(<scope>): <description>` — e.g. `fix(tron): preserve raw_data_hex in tron approvals`.

## AI-native development

This repo uses a Claude-Code-native layout: rules, commands, and agents that let Claude (and other agents following the same conventions) contribute safely without reading every file first.

| Path | What it gives you |
|---|---|
| [.claude/rules/common/](.claude/rules/common/) | Repo-wide conventions (addressing, amounts, headers, pipeline) |
| [.claude/rules/schemes/](.claude/rules/schemes/) | `exact`, `upto`, `batch-settlement`, `auth-capture`, `exact_gasfree` — invariants + gotchas |
| [.claude/rules/networks/](.claude/rules/networks/) | TRON, EVM — signing rules, chain ids, RPC defaults |
| [.claude/rules/typescript/](.claude/rules/typescript/) | TypeScript conventions (pnpm/turbo, ESM, fork+overlay, signer factories) |
| [.claude/rules/testing/](.claude/rules/testing/) | vitest unit + integration test conventions |
| [.claude/commands/x402/](.claude/commands/x402/) | Slash-command wizards (`/x402:compound`) |
| [.claude/agents/](.claude/agents/) | Specialized subagents (`code-reviewer`, `security-reviewer`, `scheme-author`) |

Each major component also has its own `CLAUDE.md` with build/test commands and local conventions: [legacy/python/x402/](legacy/python/x402/CLAUDE.md), [legacy/typescript/](legacy/typescript/CLAUDE.md), [legacy/e2e/](legacy/e2e/CLAUDE.md), [legacy/examples/](legacy/examples/CLAUDE.md), [docs/](docs/CLAUDE.md), [legacy/specs/](legacy/specs/CLAUDE.md), [legacy/integration/](legacy/integration/CLAUDE.md).

## Safety rules

- **Never** pass TRON Base58 addresses to `signTypedData`. Convert to EVM hex first. Silent failure is the default.
- **Never** amend a commit that already exists on `origin/*` unless the user explicitly asks.
- **Never** commit files that likely contain secrets (`.env`, `*private*`, `*.pem`).
- When in doubt about a risky action (force push, reset --hard, deploying contracts, touching production facilitator config), stop and ask.
