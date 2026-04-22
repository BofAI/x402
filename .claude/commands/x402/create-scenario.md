---
name: x402:create-scenario
description: Interactive wizard to scaffold a new declarative e2e scenario under e2e/scenarios/. Generates config.json, expected_*.json stubs, and a README explaining the scenario.
---

# x402:create-scenario — New e2e scenario

Scaffolds a scenario directory compatible with `integration/run.py`. The generated scenario follows the apollo-arena style (JSON config + expected JSON + diff assertion).

## Output layout

```
e2e/scenarios/<name>/
├── README.md         — scenario purpose, preconditions, run command
├── config.json       — step runner config
├── scenario_*.json   — mock-chainrpc scenario(s), if applicable (optional)
└── expected_*.json   — expected API response(s)
```

## Rules

- Ask questions **one at a time** via `AskUserQuestion`.
- Maintain a running step list and display before every "add step" prompt.
- Pre-baked step templates (choose from):
  - Build server / facilitator (`pnpm build`, `uv sync`, `go build`)
  - Start mock-chainrpc (when available)
  - Start facilitator (TS / Python / Go)
  - Start resource server (Express / FastAPI / Flask / etc.)
  - Curl x402 endpoint with payment auto-handling
  - `@json_diff` actual vs expected

## Flow

### Phase 1 — Metadata

Ask the user:
1. Scenario name (snake_case): used as the directory name under `e2e/scenarios/`
2. Scheme under test: one of `exact`, `exact_permit`, `exact_gasfree`, `upto`
3. Network under test: one of `tron:nile`, `tron:mainnet`, `eip155:11155111`, `eip155:56`, `eip155:97`, `eip155:1`
4. Purpose (one sentence): goes in the README

### Phase 2 — Steps loop

Loop until the user picks "Done":

```
Current steps:
  1. Build server
  2. Start facilitator (ts)

Add step:
  - Build server/facilitator
  - Start mock-chainrpc
  - Start facilitator
  - Start resource server
  - Curl + capture
  - @json_diff
  - Done — generate
```

For each selected step, ask the minimal sub-questions needed (workdir, port, command args), then append and loop back.

### Phase 3 — Expected payload

For each `@json_diff` step the user added, ask whether to:
- Generate an empty stub (`{}`) — user will fill in later from real run
- Paste a known-good JSON now
- Copy from an existing scenario

### Phase 4 — Generate files

Write:
- `e2e/scenarios/<name>/config.json`
- `e2e/scenarios/<name>/expected_*.json` (one per json_diff step)
- `e2e/scenarios/<name>/README.md` with purpose, preconditions, run command

Tell the user how to run it:

```bash
python3 integration/run.py --config e2e/scenarios/<name>/config.json
```

### Phase 5 — Suggest follow-ups

After generation, suggest:
- Adding an entry to `e2e/scenarios/README.md` (index)
- Wiring into `.github/workflows/` once stable
- Adding a `solutions.md` entry (`/x402:compound`) if the scenario was motivated by a specific bug
