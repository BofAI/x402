# TRON upto RPC fail-closed fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline, then one fresh read-only review.

**Goal:** Reject upto verification when required allowance/balance reads fail, and prevent settlement broadcast after failed preflight or post-delegation revalidation.
**Spec:** User request in this conversation: fix optimistic upto RPC verification, add tests and repeat code walkthrough.
**Architecture:** Keep existing authorization, amount and resource extension routing; validate uint256 account read values at the upto boundary and use the existing chain_read_failed error semantics. Preserve legitimate insufficient allowance/funds errors and intentional allowance deferral for sponsored Approval.
**Tech Stack:** TypeScript, official Core 2.28.0, Vitest, packed ESM/CJS consumers.

## Constraints and review focus
- Ordinary allowance and every required balance read fail closed, including malformed uint256 outputs.
- Accept valid bigint/atomic decimal or hex strings/safe integer RPC values; reject booleans, missing values, invalid strings, fractions, unsafe/negative/overflow values.
- Settle returns success:false, empty transaction and the verification reason before writeContract; partial/zero amounts do not bypass verification against the authorized maximum.
- Sponsored Approval may defer allowance until execution; balance reads and post-delegation revalidation remain mandatory.
- Do not leak raw RPC URLs/credentials in messages. Do not publish, change beta tags, deploy, or broadcast real transactions.

## Tasks
- [x] Add targeted account-RPC and Core verify/settle regressions; observe RED.
- [x] Replace optimistic catches and validate values; preserve success and insufficient-resource behavior; observe GREEN.
- [ ] Cover real extension registration, preflight and post-delegation balance failures; run mechanism/extension suites, types/build/lint/format and packed consumers.
- [ ] Fresh review, fix any important finding with a regression, update unreleased docs/changeset and record verified results.

## Ledger
Base: b414fc8a. Existing isolated feature worktree reused, no original checkout changes.

Implementation verification: 36 new account-state cases produced29 failures/7 passes on baseline; all36 pass after fix. Upto focused46/46, fullmechanism266/266, extension103/103. Actual extension preflight/revalidation regressions failed on old built mechanism then passed after rebuilding. Both packages source types, lint and format pass; mechanism packedstrictESM/CJS consumer (including fail-closed verify/settle assertions) passes. Combined extension packed consumer running.
Decision: no version bump or npm publish in this task; patch changeset and README explicitly distinguish unreleased source fix from published2.1.0-beta.1.
