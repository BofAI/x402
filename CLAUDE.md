# x402

This file tells Claude Code how to work in this repository.

## What this is

x402 is an open-source SDK for the **x402 open payment standard** — an HTTP `402 Payment Required` challenge-response protocol for serverless on-chain payments. Three roles participate: **Client** (payer), **Server** (resource provider), **Facilitator** (on-chain settlement).

This repository hosts the TypeScript BankofAI SDK, reference facilitator bindings, on-chain
mechanisms for TRON and EVM, runnable examples, and the protocol specs.

## Components

Each component has its own guidance with build/test commands and conventions where needed.

| Path | Language | Purpose |
|---|---|---|
| [typescript/](typescript/) | TypeScript | Current SDK monorepo: core, EVM/TRON mechanisms, extensions, HTTP adapters, and MCP. |
| [specs/](specs/) | Markdown | Normative v2 protocol, transport, scheme, and extension specifications. Read **first** when touching wire formats. |
| [examples/typescript/](examples/typescript/) | TypeScript | Runnable client, server, facilitator, logging, and MCP examples. |
| [docs/solutions.md](docs/solutions.md) | Markdown | Hard-won debugging knowledge. **Read before investigating bugs in related areas.** |

## Key reading order (new contributor)

1. [specs/x402-specification-v2.md](specs/x402-specification-v2.md) — shared wire objects,
   facilitator API, discovery, and security rules
2. Transport spec for the surface you are touching: [HTTP](specs/transports-v2/http.md) or
   [MCP](specs/transports-v2/mcp.md)
3. Scheme overview and network binding under [specs/schemes/](specs/schemes/)
4. [specs/CONTRIBUTING.md](specs/CONTRIBUTING.md) — normative documentation rules and review
   checklist
5. [docs/solutions.md](docs/solutions.md) — bug-avoidance checklist (TRON address hex, GasFree
   deadline bounds, balance source, etc.)

## Conventions

- **Addresses, selectors, event topics**: lowercase-normalized everywhere. TRON addresses are converted to **0x-prefixed EVM hex** before any EIP-712/TIP-712 signing — see [docs/solutions.md entry #1](docs/solutions.md).
- **Payment ID**: 16 random bytes, encoded as `0x` + 32 hex chars, signed as `bytes16`.
- **HTTP header encoding**: `Base64(UTF-8(JSON.stringify(object)))` for `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`.
- **Network identifiers**: CAIP-2 `eip155:<chainId>` for EVM; `tron:<decimalChainId>` for TRON (e.g. `tron:3448148188` for Nile). Deprecated `tron:0x...` values are accepted only as compatibility inputs.
- **Mechanism registration**: `tron:3448148188` (exact match, higher priority) beats `tron:*` (wildcard, lower priority).
- **Commit messages**: `<type>(<scope>): <description>` — e.g. `fix(tron): preserve raw_data_hex in tron approvals`.

## Branch workflow

- Start normal development, documentation, maintenance, and upstream-sync branches from `develop`
  and open them back to `develop`.
- Treat `main` as stable release history. Only `release_*` and `hotfix/*` branches may target
  `main`.
- Never open `develop` directly into `main`.
- Follow [BRANCHING.md](BRANCHING.md) for release back-merges, hotfixes, and branch retention.

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
| [.claude/agents/](.claude/agents/) | Specialized subagents (`code-reviewer`, `security-reviewer`) |

Component-specific instructions live in [typescript/CLAUDE.md](typescript/CLAUDE.md),
[docs/CLAUDE.md](docs/CLAUDE.md), [specs/CONTRIBUTING.md](specs/CONTRIBUTING.md), and
[.claude/rules/CLAUDE.md](.claude/rules/CLAUDE.md).

## Safety rules

- **Never** pass TRON Base58 addresses to `signTypedData`. Convert to EVM hex first. Silent failure is the default.
- **Never** amend a commit that already exists on `origin/*` unless the user explicitly asks.
- **Never** commit files that likely contain secrets (`.env`, `*private*`, `*.pem`).
- When in doubt about a risky action (force push, reset --hard, deploying contracts, touching production facilitator config), stop and ask.
