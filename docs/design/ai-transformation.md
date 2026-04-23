# x402 AI Transformation — Design

> Status: draft (v0)
> Branch: `feat/x402-ai`
> Last updated: 2026-04-22

## 1. Goal

Turn x402 into an **agent-native payment platform** along two axes:

- **Runtime axis** — any AI agent (Claude Desktop, ChatGPT, Cursor, LangChain app, OpenClaw, opencode) can consume x402-priced HTTP resources with zero glue code.
- **Engineering axis** — the x402 repository itself becomes **Claude-Code-native**: agents can extend schemes, networks, facilitators, and e2e scenarios via wizards, rules, and declarative JSON configs.

Reference projects:

- **[Coinbase x402](https://github.com/x402-foundation/x402)** — upstream MCP transport spec, MCP packages (go/python/ts/java), and the `e2e/` cartesian-product test harness.
- **[sun-protocol/apollo-arena](https://github.com/sun-protocol/apollo-arena)** — SunDeFi's in-house pattern for building Claude-Code-native repos: per-component `CLAUDE.md`, `.claude/{rules,commands,agents}`, declarative JSON scenarios with diff-based assertions, and a 233-line Python step runner.
- **[BofAI/skills](https://github.com/BofAI/skills)** — existing `x402-payment` and `agent-wallet` skills for OpenClaw / opencode consumers.

## 2. Inventory

### 2.1 Already on `main` (PR #67, 2026-04-22)

| File | Role |
|---|---|
| [docs/solutions.md](../solutions.md) | Hard-won knowledge base. Already references `/x402:compound` slash command (not yet implemented). |
| [docs/specs/protocol.md](../specs/protocol.md) | HTTP 402 v2 wire format + headers + data structures. |
| [docs/specs/roles.md](../specs/roles.md) | Client / Server / Facilitator responsibilities. Defines a five-step **payment selection pipeline** with a `[5] Apply policies` hook — this is the insertion point for budget/approval logic, no separate spec needed. |
| [docs/specs/config.md](../specs/config.md) | Static network + contract registry (TRON + EVM CAIP-2). |
| [docs/specs/exact.md](../specs/exact.md), [exact-permit.md](../specs/exact-permit.md), [exact-gasfree.md](../specs/exact-gasfree.md) | Three scheme specs. |

### 2.2 Already in sibling repos

| Repo | What it provides | Do not re-implement |
|---|---|---|
| [BofAI/skills/x402-payment](https://github.com/BofAI/skills/tree/main/x402-payment) v1.5.8 | `x402_invoke` tool + OpenClaw / opencode packaging + SKILL.md standard | agentic-IDE-style agent consumer |
| [BofAI/skills/agent-wallet](https://github.com/BofAI/skills/tree/main/agent-wallet) | Agent wallet configuration, provider switching, env-based key loading | Wallet layer of the budget story |
| [BofAI/skills/AGENTS.md](https://github.com/BofAI/skills) | `SKILL.md + examples + resources + scripts` skill convention | Skill authoring contract |
| `mcp-server-tron` (referenced by `x402-payment`) | TRON chain MCP server | On-chain MCP consumer tooling |

### 2.3 Upstream (Coinbase) worth porting

| Upstream artifact | Our target |
|---|---|
| `typescript/packages/mcp` | `packages/mcp-ts` |
| `python/x402/mcp` | `packages/mcp-py` |
| `specs/transports-v2/mcp.md` | Reference for our `docs/specs/mcp.md` (cite + diff) |
| `e2e/` (1170-line `test.ts` + `src/` + `templates/`) | `e2e/` matrix harness |
| `e2e/mock-facilitator` | `e2e/mock-facilitator` |

## 3. What's actually missing

Three pillars:

### Pillar A — Claude-Code-native repo scaffolding

The repo has no `.claude/` tree and no `CLAUDE.md` anywhere. `/x402:compound` is referenced in `docs/solutions.md` but not implemented.

Needed:

```
CLAUDE.md                              root guidance, component index
<component>/CLAUDE.md                  per-component guidance (python, typescript, specs, e2e, ...)
.claude/
├── agents/
│   ├── code-reviewer.md
│   ├── security-reviewer.md           payment-path + signature safety specialist
│   └── scheme-author.md               new scheme drafting helper
├── rules/
│   ├── common/                        lowercase addressing, payment-id format, fee-millionths
│   ├── schemes/                       exact / exact-permit / exact-gasfree / upto
│   ├── networks/                      evm / svm / tron / aptos
│   ├── typescript/ python/
│   └── testing/                       scenario conventions, diff tolerances
└── commands/
    ├── x402:compound.md               add a solutions.md entry after a fix (already referenced)
    ├── x402:create-scenario.md        wizard: new e2e scenario (config.json + expected.json)
    ├── x402:create-mcp-tool.md        wizard: register a paid MCP tool
    ├── x402:create-scheme-spec.md     wizard: draft a new scheme spec
    └── x402:onboard-network.md        wizard: add a new network to config.md + tests
```

Rationale: makes every agent session — ours and external contributors' — start with full protocol context, security gotchas, and one-command paths for extending the repo. Mirrors apollo-arena exactly.

### Pillar B — MCP transport

Skills cover OpenClaw / opencode. **They do not cover Claude Desktop, ChatGPT, Cursor, or any MCP-native client.** Those need x402 exposed as an MCP transport.

Needed:

```
packages/mcp-ts/                       port of Coinbase @x402/mcp
├── src/server/                        createPaymentWrapper — wraps an MCP tool handler
├── src/client/                        createX402MCPClient — auto retry-with-payment
└── test/unit/{server,client,wrapper}.test.ts

packages/mcp-py/                       port of Coinbase python/x402/mcp
├── server.py server_async.py server_sync.py
├── client.py client_async.py
└── tests/

docs/specs/mcp.md                      align with Coinbase specs/transports-v2/mcp.md, document diffs
docs/guides/mcp-server-with-x402.md    end-user guide (adapt Coinbase guide)
```

Rationale: every major agent UI today speaks MCP. Skills remain the right choice for OpenClaw/opencode; MCP is the right choice for everyone else. The two are complementary consumers of the same server-side payment primitive.

### Pillar C — Declarative scenario e2e + matrix

The repo has per-package unit tests but no cross-stack harness. Only `facilitator-test-report.md` + ad-hoc scripts (`compare-facilitators.ts`, `test-facilitator-v2.ts`).

Needed:

```
integration/                           vendored from apollo-arena, ~350 lines Python
├── run.py                             step runner: JSON config → sequential shell/@builtin → Markdown report
├── commands.py                        @json_diff and future built-ins
├── configs/                           example configs
├── README.md CLAUDE.md

e2e/
├── scenarios/                         apollo-arena style; each dir is one scenario
│   ├── exact_permit_happy_path/       { config.json, scenario_*.json, expected_*.json }
│   ├── exact_gasfree_happy_path/
│   ├── mcp_tron_exact/
│   ├── mcp_budget_deny/               policy rejects, no x402 header sent
│   ├── mcp_upto_partial_pay/          server asks $1, client agrees $0.5, facilitator accepts
│   ├── registry_discover_and_pay/
│   └── facilitator_compat_matrix/     BofAI ↔ Coinbase facilitator bidirectional
├── mock-chainrpc/                     vendored from apollo-arena (TRON/EVM offline JSON-RPC, hot-reload)
├── mock-facilitator/                  vendored from Coinbase e2e
├── clients/ servers/ facilitators/    Coinbase-style template dirs
└── test.ts                            Coinbase-style matrix runner with --min

tests/unit/                            per-package unit trees mirror Coinbase
```

Rationale: apollo-arena scenarios are authoring-friendly (one JSON + expected) and diff-asserted → Claude can add new scenarios with a single wizard. Coinbase matrix gives cross-impl compatibility coverage. Both modes share the same mock infra so CI doesn't depend on Nile / Sepolia.

## 4. Module responsibilities

| Module | Purpose | Ships when |
|---|---|---|
| `packages/mcp-ts`, `packages/mcp-py` | MCP server/client for x402 payment flow. Mirror Coinbase. | P2 |
| `packages/agent-tools` | LangChain / OpenAI function-calling / AutoGen wrappers around the x402 HTTP client. Distinct from skills (IDE-packaged) and MCP (transport-level). | P3 |
| `packages/budget` | Spend caps + approval hooks + audit log, implemented as **pipeline step [5] policies** (see `roles.md`). **Wallet layer already exists in `agent-wallet` skill — do not re-implement.** | P3 |
| `packages/registry` | Dynamic priced-endpoint discovery. Thin layer over `docs/specs/config.md` static data with a subscription API. | P3 |
| `integration/` | Generic step runner. Vendored from apollo-arena; no behavior changes. | P1 |
| `e2e/` | Two complementary harnesses (apollo scenarios + Coinbase matrix) sharing mock infra. | P1 scenarios, P4 matrix |
| `.claude/` | Rules, commands, subagents. | P1 |

## 5. Docs plan

New docs (in addition to what's on main):

| Path | Purpose |
|---|---|
| `docs/design/ai-transformation.md` | **this file** |
| `docs/specs/mcp.md` | x402 + MCP transport spec; reference Coinbase and document our diffs |
| `docs/specs/budget-policy.md` | Spec for the pipeline-step-5 policy contract |
| `docs/specs/registry.md` | Dynamic discovery format, subscription semantics |
| `docs/guides/agent-pays-for-api.md` | End-to-end walkthrough using `agent-tools` + `agent-wallet` skill + MCP |
| `docs/guides/mcp-server-with-x402.md` | Port of Coinbase guide, with our scheme examples |
| `docs/guides/tron-mcp.md` | TRON-specific MCP setup (exact-permit, exact-gasfree) |
| `CLAUDE.md` (root) | Navigation + pillar explainer |
| `<component>/CLAUDE.md` | Per-component: build/test commands, architecture, conventions |

## 6. Test plan

### 6.1 Unit

Mirror the Coinbase tree:

```
packages/mcp-ts/test/unit/{server,client,wrapper,types}.test.ts
packages/mcp-py/tests/unit/{test_server,test_client,test_wrapper}.py
packages/budget/test/unit/{cap,approval,audit}.test.ts
packages/registry/test/unit/{discover,subscribe,index}.test.ts
packages/agent-tools/test/unit/{langchain,openai_fc}.test.ts
```

### 6.2 Scenario e2e (apollo-arena style)

Each scenario is one directory of JSON. Run with:

```bash
python3 integration/run.py --config e2e/scenarios/<name>/config.json
```

| Scenario | Coverage | Status |
|---|---|---|
| `exact_happy_path` | EVM `exact` (ERC-3009) on BSC testnet | ✅ green (2026-04-22) |
| `exact_permit_happy_path` | EVM `exact_permit` (EIP-2612) on BSC testnet, allowance skipped | ✅ green (2026-04-22) |
| `exact_gasfree_happy_path` | TRON `exact_gasfree` (TIP-712) on Nile, GasFree API mocked on the same port, tx verification skipped | ✅ green (2026-04-22) |
| `unhappy_verify_invalid_sig` | Facilitator rejects with `invalid_signature` → server 500 | ✅ green (2026-04-22) |
| `unhappy_verify_expired` | Facilitator rejects with `deadline_expired` → server 500 | ✅ green (2026-04-22) |
| `unhappy_verify_network_mismatch` | Facilitator rejects with `network_mismatch` → server 500 | ✅ green (2026-04-22) |
| `unhappy_settle_insufficient` | Settlement fails with `insufficient_balance` → server 500 | ✅ green (2026-04-22) |
| `unhappy_settle_revert` | Settlement reverts on-chain with `settle_reverted` → server 500 | ✅ green (2026-04-22) |
| `mcp_tron_exact` | Agent → MCP → TRON payment end-to-end | 🚧 planned (needs MCP revival) |
| `mcp_budget_deny` | Pipeline step-5 policy rejects, assert no `PAYMENT-SIGNATURE` header sent | 🚧 planned |
| `mcp_upto_partial_pay` | `upto` semantics; **syncs with `feat/upto-scheme` branch** | 🚧 planned |
| `registry_discover_and_pay` | Dynamic discovery → 402 → pay | 🚧 planned |
| `facilitator_compat_matrix` | BofAI facilitator ↔ Coinbase facilitator bidirectional wire-format check | 🚧 planned (P4) |

### 6.3 Matrix e2e (Coinbase style)

`pnpm test --min`: Client × Server × Facilitator × Network × Scheme. Adding a new client/server is a directory copy.

### 6.4 Mock infrastructure

- `mock-chainrpc` (vendored from apollo-arena) — TRON + EVM JSON-RPC, scenario hot-reload. CI-safe.
- `mock-facilitator` (vendored from Coinbase e2e) — facilitator protocol conformance without on-chain settlement.

### 6.5 CI

```
.github/workflows/ai.yml:
  unit         → per-package test matrix
  scenarios    → integration/run.py over all e2e/scenarios/**
  matrix --min → Coinbase-style cartesian minimization
  nightly      → live Nile + Sepolia smoke (not on PR)
```

## 7. Phased rollout

Each phase ≈ one week, merges back to `main`, independently reviewable.

| Phase | Branch | Scope |
|---|---|---|
| **P1 — Scaffold** | `feat/x402-ai` (this branch) | `CLAUDE.md` tree, `.claude/rules/commands/agents` skeleton, `/x402:compound` as the first wizard, vendor `integration/`, first scenario `exact_permit_happy_path/` |
| **P2 — MCP** | `feat/x402-ai-mcp` | Port `packages/mcp-ts` + `packages/mcp-py` from Coinbase. Add `docs/specs/mcp.md` and guides. Add `mcp_tron_exact` scenario. |
| **P3 — Budget + Registry + Agent-tools** | `feat/x402-ai-budget` | `packages/budget` as pipeline step-5 policy. `packages/registry`. `packages/agent-tools` (LangChain / OpenAI FC). Corresponding scenarios. |
| **P4 — Matrix + TRON integration** | `feat/x402-ai-matrix` | Port Coinbase `e2e/` matrix harness. Vendor mock-facilitator. Full CI wiring. |

## 8. Non-goals

- Re-implementing the `x402-payment` or `agent-wallet` skills in-tree. They stay in `BofAI/skills` and are consumed by reference.
- Owning the MCP SDK itself — we build on `@modelcontextprotocol/sdk`.
- Replacing the existing pytest / vitest per-package tests. Unit trees are additive.

## 9. Open questions

1. **`/x402:compound` ownership** — `docs/solutions.md` already references it. Who is drafting the command? Is there a design we should align with, or is this open for P1 to claim?
2. **`x402:` namespace** — are other slash commands planned with this prefix? If so, align naming before P1 lands.
3. **skill ↔ MCP bridge** — should we ship a thin adapter that exposes the MCP server as a skill, so OpenClaw users get MCP for free? (Could be a P2.5 task, out of scope for now.)
4. **License for vendored code** — apollo-arena and Coinbase e2e are MIT. Confirm we attribute correctly in the vendored files.
5. **TRON MCP on mock-chainrpc** — does `mock-chainrpc` already simulate TIP-712 verification well enough for exact-permit scenarios, or do we need a TRON-specific mode? Flag for P2.

## 10. Immediate next steps (this branch, P1)

1. ~~Land this design doc.~~ ✅
2. ~~Add root `CLAUDE.md` + `.claude/` skeleton with `common` and `schemes` rules drawn from existing spec docs.~~ ✅
3. ~~Vendor `integration/run.py` + `commands.py` from apollo-arena (MIT attribution).~~ ✅
4. Implement `/x402:compound` as the first wizard, closing the loop with `docs/solutions.md`.
5. ~~Land `e2e/scenarios/exact_permit_happy_path/` as the canonical scenario example.~~ ✅ — plus `exact_happy_path`, `unhappy_verify_invalid_sig`, `unhappy_settle_insufficient`, `run_all.sh`, and `.github/workflows/check_e2e.yml` (2026-04-22).
