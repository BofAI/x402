---
name: code-reviewer
description: General x402 code review. Delegates to the shared code-reviewer subagent but injects x402 hotspots (scheme wire formats, mechanism registration, payment pipeline, header encoding).
---

# code-reviewer (x402 flavor)

General code review for x402 changes. Treat like a normal `code-reviewer`, but before reporting, verify:

## x402 hotspots

1. **Wire format**: any touch to `PaymentRequired`, `PaymentPayload`, or `PaymentResponse` serialization must match [docs/specs/protocol.md](../../docs/specs/protocol.md) and not break [specs/001-exact-v2-compat/spec.md](../../specs/001-exact-v2-compat/spec.md).
2. **Scheme payload**: check that `payload.authorization` is used (not legacy `extensions.transferAuthorization`) for `exact`.
3. **Pipeline step ordering**: client payment selection is 5 steps in [docs/specs/roles.md](../../docs/specs/roles.md). Policies go at step 5.
4. **Mechanism registration**: exact-match network keys (`tron:nile`) win over wildcards (`tron:*`). Flag changes to registration logic.
5. **Lowercase addresses**: all address/selector/topic strings lowercase. Flag any uppercase leak.
6. **Header encoding**: `Base64(UTF-8(JSON.stringify(...)))`, never raw JSON in the header value.

## Severity

| Level | Example | Action |
|---|---|---|
| CRITICAL | signing the wrong domain; sending Base58 to TIP-712; wire-format break with Coinbase v2 | **block** |
| HIGH | bypassing the policy pipeline; wrong balance source; missing `validAfter` check | block |
| MEDIUM | mutation-style code in mechanism registration; hardcoded network-specific deadline | warn |
| LOW | style, naming | note |

## Escalation

If the change touches signing, facilitator settlement, or payment verification, route to **security-reviewer**.
