# Upto RPC Fail-Closed Validation Record

Date: 2026-10-19 (Asia/Shanghai). Range: `b414fc8a..a39d486e`; branch `feat/tron-official-sdk`. Requested scope: fix optimistic TRON upto preflight on RPC errors, add tests, and review again.

## Behavior

- Required allowance/balance RPC exceptions return `isValid:false`, `invalidReason:chain_read_failed`, fixed `invalidMessage:TRON contract read failed`, and payer.
- Invalid uint256 outputs also reject: missing/null/bool/object/array, invalid or empty strings, negative values, overflow, non-integers, unsafe integers, and NaN/Infinity. Implicit relational comparisons are not used to accept invalid results.
- Bigint, atomic decimal/hex strings, and safe integers remain supported. Genuine insufficiency still returns `permit2_allowance_required` / `insufficient_funds`. Offline inspection confirms real TronWeb uint256 ABI decoding produces bigint, returned directly by single-output `.call()`.
- Settle still revalidates the authorized maximum before partial or zero settlement. Failure returns `success:false`, `errorReason:chain_read_failed`, and an empty transaction, without signing a settlement transaction or waiting for a receipt.
- Resource extension preflight can still defer allowance until Approval, but balance is always required. Post-delegation scheme revalidation failure rejects through the runtime; registered extension integration tests confirm settlement does not proceed.
- Responses do not expose original RPC URLs, credential fragments, or exception diagnostics.

## Regression evidence

- 36 new mechanism cases: baseline 29 failed/7 passed; fixed 36 passed. Coverage includes official Core verify/settle, both read failure types, invalid/valid values, genuine insufficiency, partial/zero amounts, and resource callback balance rejection.
- Two new resource extension integration cases use real offline signed Approval and official Core extension registration. They failed with old mechanism artifacts and passed after rebuilding fixed artifacts, covering initial preflight and post-delegation RPC revalidation.
- Full mechanism: 28 files, 266/266; full extension: 7 files, 103/103.
- Both packages passed source TypeScript, build, lint, and format. Node25 warnings about the existing ESLint config's module type did not affect exit status.
- Independent packed consumers passed strict TypeScript 5.7.3 NodeNext, ESM/CJS, 20+5 public entrypoints, real offline Approval signing, and extension registration. Mechanism ESM/CJS consumers additionally assert verify/settle rejection and zero broadcasts on allowance/balance failure.
- Logs are `/tmp/upto-fail-closed-` prefixed `.log` files, including red, green, full, extension-red, ext-green, consumer, and ext-consumer.

## Scope

This phase changed source, regressions, and a pending patch changeset only. It did not change npm versions/tags, publish, push, merge, deploy, or initiate live chain transactions. Published `2.1.0-beta.1` did not include this fix; README distinguished published artifacts from then-unreleased source.

## Independent review

A fresh-context reviewer inspected `b414fc8a..a39d486e` read-only, finding no blocker, deferred minor, or triggerable regression introduced by the patch. The reviewer reran two upto test files with isolated configuration that did not load default environment variables: 46/46 passed. An offline stub of `triggerSmartContract` exercised the same real TronWeb allowance/balanceOf ABI `.call()`; both returned `2000000n`.

Review checked both catch blocks, uint256 conversion, partial/zero settlement ordering, deferred sponsored allowance, and mandatory balance revalidation. Full builds/packed consumers were not independently repeated; implementation-run evidence was used. New resource tests used real extension registration and a simulated runtime, without live delegation, chain transactions, or resource recovery.

Publication follow-up: the fix was subsequently included in `2.1.0-beta.2`, with both packages published together and post-publication external compatibility validation passing. See the [beta.2 release record](../../releases/2.1.0-beta.2.md). The unpublished status above refers to initial acceptance of this fix.
