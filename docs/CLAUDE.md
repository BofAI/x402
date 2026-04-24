# docs/

User-facing documentation and working-knowledge notes. **Not authoritative** — protocol specs live in [`specs/`](../specs/) at the repo root (mirrors upstream `x402-foundation/x402/specs/`).

## Layout

| Path | Purpose |
|---|---|
| [solutions.md](solutions.md) | **Hard-won knowledge base.** Append-only incident log. Read before investigating any payment-path bug. |
| [design/](design/) | Design docs for in-flight work. `ai-transformation.md` is the AI-native plan. |

## Rules

- **Not a duplicate of `specs/`.** Never copy wire format, role, config, or scheme definitions here. Link to `specs/` instead.
- **`solutions.md` entries are append-only.** Never reorder or delete historical entries. Use `/x402:compound` to add a new one after fixing a non-obvious bug.
- **Design docs go in `docs/design/`.** They describe architectural direction, not the final protocol state — once a design lands, the protocol-level outcome moves into `specs/`.
