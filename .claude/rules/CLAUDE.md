# .claude/rules/ — knowledge base index

This is the rules knowledge base. Every file here is a **self-contained rule sheet** Claude loads on demand when the touched code matches its scope. Rules override defaults; CLAUDE.md at the repo root sets the floor.

The SDK is a **TypeScript-only** pnpm/turbo monorepo under [typescript/](../../typescript/CLAUDE.md). `core` and `mechanisms/evm` are **upstream forks** (keep byte-identical, additions go in overlays); `mechanisms/tron` is in-house. There is no Python in the current SDK. (The previous-generation Python + old TypeScript code lives under `legacy/` and is slated for removal — these rules do **not** cover it.)

## When Claude reads what

| Scope of the change | Always read | Also read |
|---|---|---|
| Any file in the repo | [common/conventions.md](common/conventions.md) | — |
| TypeScript under `typescript/packages/` | common/ | [typescript/conventions.md](typescript/conventions.md) |
| Scheme `exact` (ERC-3009 / Permit2) | common/ | [schemes/exact.md](schemes/exact.md) |
| Scheme `upto` (usage-based) | common/ | [schemes/upto.md](schemes/upto.md) |
| Scheme `batch-settlement` (payment channels) | common/ | [schemes/batch-settlement.md](schemes/batch-settlement.md) |
| Scheme `auth-capture` (EVM authorize+capture) | common/ | [schemes/auth-capture.md](schemes/auth-capture.md) |
| Scheme `exact_gasfree` (TRON GasFree) | common/ | [schemes/exact-gasfree.md](schemes/exact-gasfree.md) + [networks/tron.md](networks/tron.md) |
| TRON mechanisms (`mechanisms/tron`) | common/ | [networks/tron.md](networks/tron.md) |
| EVM mechanisms (`mechanisms/evm`) | common/ | [networks/evm.md](networks/evm.md) |
| Tests (`packages/*/test/**`) | common/ | [testing/conventions.md](testing/conventions.md) |

When multiple rule files apply, read all of them before editing. Rules are layered, not exclusive.

## Layout

```
.claude/rules/
├── common/
│   └── conventions.md      # repo-wide: addressing, amounts, headers, pipeline, commit style
├── schemes/
│   ├── exact.md            # ERC-3009 / Permit2 (extra.assetTransferMethod)
│   ├── upto.md             # usage-based: sign up-to-max, settle actual
│   ├── batch-settlement.md # payment channels: deposit + off-chain vouchers + refund
│   ├── auth-capture.md     # EVM authorize then capture
│   └── exact-gasfree.md    # TRON GasFree custodial + TIP-712 relayer
├── networks/
│   ├── evm.md              # eip155:<chainId>, contracts, signing
│   └── tron.md             # tron:<hexChainId>, TIP-712 hex-address rule, GasFree link
├── typescript/
│   └── conventions.md      # pnpm/turbo, ESM, viem/tronweb, fork+overlay, signer factories
└── testing/
    └── conventions.md      # vitest unit + integration layout, self-skip, mocking
```

## Authoring a new rule

Add a rule **only when the knowledge is non-obvious and would otherwise be relearned by reading prod incidents**. Rules earn their place by preventing a bug that already happened, or codifying a convention that silently breaks things when ignored.

Structure every rule file:

1. **Header** — one line: what scope this covers + pointer to the authoritative source (the package source, or [typescript/CLAUDE.md](../../typescript/CLAUDE.md)).
2. **When to use** — the decision the rule answers.
3. **Key invariants** — the short list that must hold.
4. **Common gotchas** — cite commits. Every bullet should map to a real incident.
5. **Testing** — where the tests live and what template to reuse.

### New scheme

1. New scheme classes per role under `mechanisms/<chain>/src/<scheme>/{client,facilitator,server}` — `<Scheme><Chain>Scheme`, same class name across roles, role = import subpath (see [typescript/CLAUDE.md](../../typescript/CLAUDE.md)).
2. New rule at `.claude/rules/schemes/<scheme>.md`.
3. Register the scheme on the client/facilitator with `new + register` (thin pass-through register helpers are not added).

### New network

1. New rule at `.claude/rules/networks/<name>.md` — chain ids, signing rules, RPC defaults, contract table.
2. If it introduces a new signing flavor (e.g. a TIP-712 analogue), document the conversion helpers.

## Relation to other surfaces

- **[typescript/CLAUDE.md](../../typescript/CLAUDE.md)** — the SDK's own build/test/layout guide and the fork/overlay + signer-factory + scheme-API rules. Rules here cite it; it is the authoritative source for structure.
- **.claude/agents/** — specialized reviewers (`code-reviewer`, `security-reviewer`) that load the rules relevant to their domain. Payment-path / signing changes route through `security-reviewer`.
- **.claude/commands/x402/** — slash-command wizards that scaffold code conforming to these rules.

## Don'ts

- **No code examples longer than 10 lines** in a rule.
- **No rule without a scope.** If you can't say which file touches trigger it, it belongs in `CLAUDE.md` instead.
- **No rules that rot.** Anything citing a specific line number or commit that isn't a historical anchor will drift — prefer filenames and invariants.
