# specs/

Single source of truth for protocol specifications, plus a staging area for in-flight feature work. Layout follows the upstream [`x402-foundation/x402/specs/`](https://github.com/x402-foundation/x402/tree/main/specs) — top-level `.md` files are authoritative, scheme specs live under `schemes/`, feature-in-flight specs live under numbered subdirs.

## Layout

```
specs/
├── protocol.md              — HTTP 402 wire format, headers, encoding
├── roles.md                 — Client / Server / Facilitator; 5-step selection pipeline
├── config.md                — authoritative network + contract registry
├── schemes/
│   ├── exact.md             — ERC-3009 transferWithAuthorization
│   ├── exact-permit.md      — EIP-2612 / TIP-2612 permit + transferFrom
│   └── exact-gasfree.md     — TRON GasFree custodial + TIP-712 relayer
└── <NNN>-<slug>/            — in-flight feature spec (spec-kit template)
    ├── spec.md              — requirements, acceptance criteria, open questions
    ├── plan.md              — implementation plan (if present)
    ├── tasks.md             — task breakdown (if present)
    └── notes/               — QA logs, review comments, decisions
```

## Current feature specs

- [001-exact-v2-compat/](001-exact-v2-compat/) — aligning `exact` with Coinbase x402 v2 wire format. Implementation complete; QA in progress.

## Rules

- **Top-level `.md` files are authoritative.** If code disagrees with a spec, the bug is in the code unless the spec is marked `Status: draft`.
- **Feature dirs are numbered** (`001-`, `002-`, ...) for chronological ordering. One dir per feature. Driven by `.specify/`.
- **On merge, promote the delta.** When a feature lands in `main`, fold the accepted changes into the relevant top-level spec (or `schemes/<scheme>.md`) and delete or archive the feature dir under `archive/`.
- **Feature dirs cite — never duplicate — top-level specs.** Feature specs describe the *delta*; protocol specs describe the *target state*.
- **Adding a new scheme** = new `schemes/<scheme>.md` + new rule at `.claude/rules/schemes/<scheme>.md` + entry in `config.md` registry.
- **Adding a new network** = new entry in `config.md` + new rule at `.claude/rules/networks/<name>.md`.

## Relationship to other surfaces

- [`docs/`](../docs/) — user-facing guides, design docs, and `solutions.md` (hard-won knowledge). Not authoritative; defers to `specs/`.
- [`.claude/rules/`](../.claude/rules/) — behavioral guidance for Claude when editing code. Cites specs; does not duplicate them.
- Upstream — mirrors the layout of `x402-foundation/x402/specs/` to keep drift tractable when porting or contributing back.
