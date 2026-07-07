---
status: complete
priority: p2
issue_id: "001"
tags: [code-review, correctness, tron, payments]
dependencies: []
---

# Strip advisory fee metadata from exact and upto requirements

## Problem Statement

The branch claims to remove advisory fees from TRON `exact` and `upto`, but both
server schemes still preserve an upstream `paymentRequirements.extra.fee` value.
Clients now ignore that value, so callers can receive fee metadata which is not
included in allowance calculations or enforced during settlement.

## Findings

- `exact/server/scheme.ts:140` spreads all existing `extra` fields into the output.
- `upto/server/scheme.ts:111` does the same.
- The deleted `fee-plumbing.test.ts` explicitly asserted that upstream fees were
  preserved; no replacement test asserts the new no-fee invariant.
- This contradicts the README statement that exact and upto do not advertise a fee.

## Proposed Solutions

### Option 1: Remove fee during enhancement

Destructure `fee` out of existing extras before constructing the enhanced
requirements, and add exact/upto regression tests.

**Pros:** Enforces the documented invariant at the server boundary.

**Cons:** Intentionally discards caller-provided metadata.

**Effort:** Small

**Risk:** Low

### Option 2: Preserve metadata and narrow the documentation

Document that only facilitator-generated fee configuration was removed and that
custom upstream fee metadata is passed through but ignored.

**Pros:** Preserves generic metadata behavior.

**Cons:** Leaves misleading, non-enforced payment terms in challenges.

**Effort:** Small

**Risk:** Medium

## Recommended Action

Strip `fee` from a copied `extra` object in both server schemes and cover exact,
exact-without-method, and upto behavior with regression tests.

## Technical Details

Affected files:
- `typescript/packages/mechanisms/tron/src/exact/server/scheme.ts`
- `typescript/packages/mechanisms/tron/src/upto/server/scheme.ts`
- TRON exact/upto server tests

## Acceptance Criteria

- [x] Exact and upto challenges cannot contain advisory `extra.fee` metadata.
- [x] Regression tests cover caller-provided `extra.fee`.
- [x] GasFree fee metadata remains unchanged.
- [x] TRON unit tests pass.

## Work Log

### 2026-07-07 - Initial review

**By:** Codex

**Actions:** Traced server enhancement and client allowance paths and identified
the surviving metadata pass-through.

**Learnings:** Removing fee generation alone does not remove pre-existing fee
metadata because the entire `extra` object is preserved.

### 2026-07-07 - Completed

**By:** Codex

**Actions:** Stripped fee metadata from both server schemes, added three
regression tests, and ran the complete TRON test suite and build.

**Learnings:** Exact's no-transfer-method early return also needed sanitization.
