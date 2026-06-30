---
name: scheme-author
description: Helper for drafting a new x402 scheme. Walks the author through the required sections of a scheme spec (overview, identifier, domain, message type, lifecycle, facilitator path, testability) using existing schemes as templates.
---

# scheme-author

Help the contributor draft a new scheme spec under `specs/<scheme>.md` using [specs/schemes/exact.md](../../specs/schemes/exact.md), [exact-permit.md](../../specs/schemes/exact-permit.md), and [exact-gasfree.md](../../specs/schemes/exact-gasfree.md) as templates.

## Output

A new `specs/<scheme>.md` with these sections (order matters):

1. **Overview** — one-paragraph pitch, who pays what to whom, under what constraints.
2. **Scheme identifier** — the string literal used in `PaymentRequired.accepts[].scheme`.
3. **When to use** — conditions that make this scheme the right choice.
4. **When not to use** — conditions that disqualify it.
5. **Wire format** — the `PaymentRequired` and `PaymentPayload` shape for this scheme, strictly.
6. **Signing specification** — domain, message type definition, field semantics. For anything EIP-712 / TIP-712, enumerate every field.
7. **Client lifecycle** — ordered steps from 402 receipt to final request retry.
8. **Server lifecycle** — pre-check contract: what the server validates before calling the facilitator.
9. **Facilitator lifecycle** — verify + settle contract: what happens on-chain.
10. **Edge cases & rejections** — specific error codes, replay protection, deadline boundaries.
11. **Testing strategy** — which existing harnesses apply, which need to be extended.
12. **Open questions** — explicit TODOs for maintainers.

## Flow

1. Ask the author these questions one at a time (`AskUserQuestion`):
   - Scheme name (snake_case)
   - Target networks (EVM only / TRON only / both / other)
   - Token model (ERC-3009 / EIP-2612 / approve+transferFrom / custodial / ...)
   - Who pays gas (payer / facilitator / custodial relayer)
   - Fixed amount or range (pick `exact`-style or `upto`-style)
   - Motivating use-case (one sentence)

2. Generate the skeleton with all 12 sections, filling:
   - Overview from the motivating use-case answer
   - "When to use" / "When not to use" from the token-model + gas answers
   - Signing section with placeholders that reference the closest existing scheme's exact structure

3. After generation, suggest:
   - Adding a corresponding `.claude/rules/schemes/<scheme>.md` summarizing gotchas
   - Adding `vitest` unit tests under `mechanisms/<chain>/test/unit/<scheme>/`
   - Registering the scheme on the client/facilitator with `new + register`

## Constraints

- Do NOT invent signing domains. Always ground them in deployed contract source.
- Do NOT propose on-chain contracts as part of the spec — those are implementation, not protocol.
- DO enumerate wire-format compatibility with Coinbase x402 v2 explicitly. If the new scheme diverges, say so and explain why.
