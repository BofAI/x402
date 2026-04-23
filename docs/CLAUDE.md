# docs/

Canonical protocol documentation. **Read these first before touching wire formats or payment flow.**

## Layout

| Path | Purpose |
|---|---|
| [specs/protocol.md](specs/protocol.md) | HTTP wire format, headers, encoding |
| [specs/roles.md](specs/roles.md) | Client / Server / Facilitator responsibilities + 5-step payment selection pipeline |
| [specs/config.md](specs/config.md) | Authoritative network + contract registry |
| [specs/exact.md](specs/exact.md), [exact-permit.md](specs/exact-permit.md), [exact-gasfree.md](specs/exact-gasfree.md) | Per-scheme specs |
| [solutions.md](solutions.md) | **Hard-won knowledge base.** Read before investigating any payment-path bug. |
| [design/](design/) | Design docs for in-flight work. `ai-transformation.md` is the AI-native plan. |

## Rules

- **`docs/specs/` is authoritative.** If code disagrees with a spec, the bug is in the code unless the spec is explicitly marked `Status: draft`.
- **Adding a new scheme or network** = new spec doc (`docs/specs/<name>.md`) + new rule file under `.claude/rules/{schemes,networks}/` + entry in the registry in `config.md`.
- **`solutions.md` entries are append-only.** Never reorder or delete historical entries. Use `/x402:compound` to add a new one after fixing a non-obvious bug.
- **Design docs go in `docs/design/`.** `specs/` at the repo root (not under `docs/`) is for **in-flight feature specs** (e.g. `001-exact-v2-compat/`); `docs/specs/` is for **protocol-level** specs. Don't conflate them.
