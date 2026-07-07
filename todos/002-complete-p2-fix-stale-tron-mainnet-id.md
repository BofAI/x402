---
status: complete
priority: p2
issue_id: "002"
tags: [code-review, documentation, tron]
dependencies: []
---

# Fix stale TRON mainnet network identifier

## Problem Statement

The examples README instructs users to use `tron:mainnet`, but the current SDK
requires the hex CAIP-2 identifier `tron:0x2b6653dc` and rejects legacy names.
This is especially risky in a section describing real-funds configuration.

## Findings

- `examples/typescript/README.md:132` uses `tron:mainnet`.
- The same file's table and the example source use `tron:0x2b6653dc`.
- The existing CAIP-2 changeset states that legacy string IDs now throw.

## Proposed Solutions

### Option 1: Replace the stale identifier

Change `tron:mainnet` to `tron:0x2b6653dc`.

**Pros:** Correct and consistent with code and migration guidance.

**Cons:** None.

**Effort:** Small

**Risk:** Low

### Option 2: Use the exported constant name

Describe the network as `TRON_MAINNET` (`tron:0x2b6653dc`).

**Pros:** Improves discoverability of the canonical constant.

**Cons:** Slightly more verbose in an operational README.

**Effort:** Small

**Risk:** Low

## Recommended Action

Replace the legacy identifier with the canonical hex CAIP-2 identifier.

## Technical Details

Affected file: `examples/typescript/README.md:132`.

## Acceptance Criteria

- [x] The mainnet section uses `tron:0x2b6653dc`.
- [x] No legacy TRON network names remain in affected documentation.

## Work Log

### 2026-07-07 - Initial review

**By:** Codex

**Actions:** Compared documentation against constants, example registrations,
and the CAIP-2 breaking changeset.

**Learnings:** A post-merge documentation edit reintroduced the removed legacy ID.

### 2026-07-07 - Completed

**By:** Codex

**Actions:** Updated the mainnet documentation and verified affected docs contain
no legacy TRON network names.

**Learnings:** The canonical identifier now matches constants and example code.
