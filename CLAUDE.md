# x402

This file tells Claude Code how to work in this repository.

## What this is

x402 is an open-source SDK for the **x402 open payment standard** — an HTTP `402 Payment Required` challenge-response protocol for serverless on-chain payments. Three roles participate: **Client** (payer), **Server** (resource provider), **Facilitator** (on-chain settlement).

This repository hosts the BankofAI SDK (Python + TypeScript), the reference facilitator bindings, on-chain mechanisms for TRON and EVM, and the protocol specs.

## Components

Each component has its own `CLAUDE.md` (where present) with build/test commands and conventions.

| Path | Language | Purpose |
|---|---|---|
| [python/x402/](python/x402/) | Python | SDK: client, server (FastAPI/Flask), facilitator, mechanisms (EVM + TRON). |
| [typescript/](typescript/) | TypeScript | SDK: fetch client, server middleware, facilitator, mechanisms (EVM + TRON). |
| [docs/specs/](docs/specs/) | Markdown | Protocol + role + scheme + config specifications. Read **first** when touching wire formats. |
| [docs/solutions.md](docs/solutions.md) | Markdown | Hard-won debugging knowledge. **Read before investigating bugs in related areas.** |
| [docs/design/](docs/design/) | Markdown | Design documents for in-flight work. |
| [specs/](specs/) | Markdown | In-flight feature specs (e.g. `001-exact-v2-compat`). |
| [examples/](examples/) | Mixed | Smoke tests and integration examples. |
| [integration/](integration/) | Python | Generic step runner used by `e2e/scenarios/`. |
| [e2e/](e2e/) | Mixed | Declarative scenario tests and (future) matrix harness. |
| [tron-contribution/](tron-contribution/) | Markdown | Upstream contribution planning for `x402-foundation/x402`. |

## Key reading order (new contributor)

1. [docs/specs/protocol.md](docs/specs/protocol.md) — wire format, headers, encoding
2. [docs/specs/roles.md](docs/specs/roles.md) — Client / Server / Facilitator; **payment selection pipeline** (policy hook at step 5)
3. [docs/specs/config.md](docs/specs/config.md) — network + contract registry
4. Scheme spec for the scheme you are touching: [`exact.md`](docs/specs/exact.md) · [`exact-permit.md`](docs/specs/exact-permit.md) · [`exact-gasfree.md`](docs/specs/exact-gasfree.md)
5. [docs/solutions.md](docs/solutions.md) — bug-avoidance checklist (TRON address hex, GasFree deadline bounds, balance source, etc.)

## Conventions

- **Addresses, selectors, event topics**: lowercase-normalized everywhere. TRON addresses are converted to **0x-prefixed EVM hex** before any EIP-712/TIP-712 signing — see [docs/solutions.md entry #1](docs/solutions.md).
- **Payment ID**: 16 random bytes, encoded as `0x` + 32 hex chars, signed as `bytes16`.
- **HTTP header encoding**: `Base64(UTF-8(JSON.stringify(object)))` for `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`.
- **Network identifiers**: CAIP-2 `eip155:<chainId>` for EVM; `tron:<name>` for TRON.
- **Mechanism registration**: `tron:nile` (exact match, higher priority) beats `tron:*` (wildcard, lower priority).
- **Commit messages**: `<type>(<scope>): <description>` — e.g. `fix(tron): preserve raw_data_hex in tron approvals`.

## AI-native development

This repo is adopting a Claude-Code-native layout. See [docs/design/ai-transformation.md](docs/design/ai-transformation.md) for the full plan.

| Path | What it gives you |
|---|---|
| [.claude/rules/](.claude/rules/) | Per-topic rules: conventions, schemes, networks, languages |
| [.claude/commands/](.claude/commands/) | Slash-command wizards (e.g. `/x402-compound` to log a new solution) |
| [.claude/agents/](.claude/agents/) | Specialized subagents (code-reviewer, security-reviewer, scheme-author) |

## Safety rules

- **Never** pass TRON Base58 addresses to `signTypedData`. Convert to EVM hex first. Silent failure is the default.
- **Never** amend a commit that already exists on `origin/*` unless the user explicitly asks.
- **Never** commit files that likely contain secrets (`.env`, `*private*`, `*.pem`).
- When in doubt about a risky action (force push, reset --hard, deploying contracts, touching production facilitator config), stop and ask.
