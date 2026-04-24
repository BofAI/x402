---
name: x402:compound
description: Interactive wizard to add a new entry to docs/solutions.md after solving a problem. Captures category, severity, symptom, root cause, fix, rule, and refs in the standard format.
---

# x402:compound — Add a solutions.md entry

This command is referenced by `docs/solutions.md` as the canonical way to record hard-won knowledge. Use it immediately after fixing a non-obvious bug so the lesson is captured while the context is fresh.

## Rules

- Ask **one question at a time** via `AskUserQuestion`. Do not batch.
- Maintain the 7-field structure used in `docs/solutions.md`:
  1. **Title** — one-sentence imperative
  2. **Category** — one of: `signing`, `config`, `policy`, `wire-format`, `facilitator`, `client`, `server`, `network`, `build`
  3. **Severity** — one of: `critical`, `high`, `medium`, `low`
  4. **Module** — comma-separated component names (e.g. `gasfree, mechanisms`)
  5. **Symptom** — observed behavior, what went wrong
  6. **Root cause** — why it happened
  7. **Fix** — what was actually changed
  8. **Rule** — general invariant or check derived from the fix
  9. **Ref** — PR number + commit SHA(s)

## Flow

### Phase 1 — Read the current file

Read `docs/solutions.md`. Note the current highest-numbered entry so we know what number to assign.

### Phase 2 — Gather fields one at a time

For each of title, category, severity, module, symptom, root cause, fix, rule, ref — ask a single `AskUserQuestion`. For the enum fields (category, severity), provide the enum options in the question. For refs, offer "I'll fill in later" as an option and insert `TODO` if chosen.

### Phase 3 — Generate and append

Format the entry as:

```markdown
### N. <title>

- **Category**: <category>
- **Severity**: <severity>
- **Module**: <module>

**Symptom**: <symptom>

**Root cause**: <root-cause>

**Fix**: <fix>

**Rule**: <rule>

**Ref**: <ref>

---
```

Insert immediately before the next `---` separator that follows the current highest entry, or append at the end before any trailing content. Show the user the final diff and confirm before writing.

### Phase 4 — Confirm

After writing, tell the user:
- The entry number assigned
- Whether a follow-up is needed (e.g. adding a test, updating a rule in `.claude/rules/`)
