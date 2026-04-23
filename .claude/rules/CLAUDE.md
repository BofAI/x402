# .claude/rules/ — knowledge base index

This is the rules knowledge base. Every file here is a **self-contained rule sheet** Claude loads on demand when the touched code matches its scope. Rules override defaults; CLAUDE.md at the repo root sets the floor.

## When Claude reads what

| Scope of the change | Always read | Also read |
|---|---|---|
| Any file in the repo | [common/conventions.md](common/conventions.md) | — |
| Python code under `python/x402/` | common/ | [python/conventions.md](python/conventions.md) |
| TypeScript under `typescript/packages/` | common/ | [typescript/conventions.md](typescript/conventions.md) |
| Scheme `exact` (ERC-3009) code or spec | common/ | [schemes/exact.md](schemes/exact.md) |
| Scheme `exact_permit` (EIP-2612) code or spec | common/ | [schemes/exact-permit.md](schemes/exact-permit.md) |
| Scheme `exact_gasfree` (TRON GasFree) code or spec | common/ | [schemes/exact-gasfree.md](schemes/exact-gasfree.md) + [networks/tron.md](networks/tron.md) |
| TRON mechanisms / config | common/ | [networks/tron.md](networks/tron.md) |
| EVM mechanisms / config | common/ | [networks/evm.md](networks/evm.md) |
| e2e scenarios (`e2e/scenarios/`, `integration/`) | common/ | [testing/scenarios.md](testing/scenarios.md) |

When multiple rule files apply, read all of them before editing. Rules are layered, not exclusive.

## Layout

```
.claude/rules/
├── common/
│   └── conventions.md      # repo-wide: addressing, amounts, headers, pipeline, commit style
├── schemes/
│   ├── exact.md            # ERC-3009 transferWithAuthorization
│   ├── exact-permit.md     # EIP-2612 / TIP-2612 permit + transferFrom
│   └── exact-gasfree.md    # TRON GasFree custodial + TIP-712 relayer
├── networks/
│   ├── evm.md              # eip155:<chainId>, contracts, signing, smoke tests
│   └── tron.md             # tron:<name>, TIP-712 hex-address rule, GasFree link
├── python/
│   └── conventions.md      # Python 3.11+, uv, pytest, pydantic v2, async-first
├── typescript/
│   └── conventions.md      # Node 20+, pnpm, ESM, viem, BigInt, named exports
└── testing/
    └── scenarios.md        # e2e/scenarios/ JSON scenario authoring + ports + tiers
```

## Authoring a new rule

Add a rule **only when the knowledge is non-obvious and would otherwise be relearned by reading prod incidents**. Rules earn their place by preventing a bug that already happened, or codifying a convention that silently breaks things when ignored.

Structure every rule file:

1. **Header** — one line: what scope this covers + pointer to the canonical spec under `docs/specs/`.
2. **When to use** — the decision the rule answers.
3. **Key invariants** — the short list that must hold.
4. **Common gotchas** — cite commits or `docs/solutions.md` entries. Every bullet should map to a real incident.
5. **Testing** — where the tests live and what template to reuse.

### New scheme

1. New spec at `docs/specs/<scheme>.md`.
2. New rule at `.claude/rules/schemes/<scheme>.md` — link back to the spec.
3. Register the scheme in the mechanism and the `config.md` registry.
4. Scenario skeleton: `/x402:create-scenario` (see [../commands/x402/create-scenario.md](../commands/x402/create-scenario.md)).

### New network

1. Add to `docs/specs/config.md` registry.
2. New rule at `.claude/rules/networks/<name>.md` — chain ids, signing rules, RPC defaults, contract table.
3. If it introduces a new signing flavor (e.g. TIP-712 analogue), document the conversion helpers.

## Relation to other surfaces

- **docs/specs/** — authoritative protocol definitions. Rules cite specs; specs do not cite rules.
- **docs/solutions.md** — incident log. Rules point here when a gotcha came from a real bug; new solutions are added via `/x402:compound`.
- **.claude/agents/** — specialized reviewers (`code-reviewer`, `security-reviewer`, `scheme-author`) that load the rules relevant to their domain. Payment-path / signing changes route through `security-reviewer`.
- **.claude/commands/x402/** — slash-command wizards that scaffold code + scenarios conforming to these rules.

## Don'ts

- **No code examples longer than 10 lines** in a rule. If it needs more, it belongs in `docs/specs/` or an example.
- **No duplicating specs.** Rules are *behavioral guidance*; specs are *definitions*. Link, don't copy.
- **No rule without a scope.** If you can't say which file touches trigger it, it belongs in `CLAUDE.md` instead.
- **No rules that rot.** Anything citing a specific line number or commit that isn't a historical anchor will drift — prefer filenames and invariants.
