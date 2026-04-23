# specs/ (feature specs)

**In-flight feature specs**, one dir per feature, driven by `.specify/`. Distinct from [`docs/specs/`](../docs/specs/), which holds protocol-level specifications.

## Layout

```
specs/<NNN>-<slug>/
├── spec.md          — requirements, acceptance criteria, open questions
├── plan.md          — implementation plan (if present)
├── tasks.md         — task breakdown (if present)
└── notes/           — QA logs, review comments, decisions
```

## Current

- [001-exact-v2-compat/](001-exact-v2-compat/) — aligning `exact` with Coinbase x402 v2 wire format. Implementation complete; QA in progress.

## Rules

- **One dir per feature.** Numbered (`001-`, `002-`, ...) for easy chronological ordering.
- **Specs stay live until the feature merges to `main`.** After merge, either archive the dir under `specs/archive/` or delete it once the state is fully captured in `docs/specs/` and `CHANGELOG.md`.
- **Do not duplicate `docs/specs/`.** Reference them instead. Feature specs describe the *delta*; protocol specs describe the *target state*.
