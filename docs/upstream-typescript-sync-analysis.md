# Upstream TypeScript Sync Analysis

## Comparison checkpoint

This document records the checkpoint used to compare `x402-foundation/x402` with the BankofAI TypeScript fork. Future reviews should start after the recorded upstream end commit and compare against the then-current target HEAD.

| Repository | Path | Commit | Date |
| --- | --- | --- | --- |
| Upstream source | `/Users/roger/Project/develop/foundation-x402/x402` | Start, exclusive: `d454eb9b9557c5d48dc641dd0ec48dc605919b03` | 2026-06-08 22:53:39 +02:00 |
| Upstream source | `/Users/roger/Project/develop/foundation-x402/x402` | End, inclusive: `2b74587b29bd7d986c4c562e46444d74606b0e1d` | 2026-07-06 |
| Target fork | `/Users/roger/Project/develop/x402` | HEAD examined: `e158640a7ebf2ade6c7a6e2dc0fbfdfc6f3f0e79` | 2026-07-07 |

Upstream range examined:

```text
d454eb9b9557c5d48dc641dd0ec48dc605919b03..2b74587b29bd7d986c4c562e46444d74606b0e1d
```

The range contains 72 commits, 615 changed files, 52,672 insertions, and 19,013 deletions.

## Latest upstream supplement

Fetched upstream `origin/main` on 2026-07-13. The new checkpoint extends the previous reviewed upstream end commit to:

| Repository | Path | Commit | Date |
| --- | --- | --- | --- |
| Upstream source | `/Users/roger/Project/develop/foundation-x402/x402` | Previous end, exclusive: `2b74587b29bd7d986c4c562e46444d74606b0e1d` | 2026-07-06 |
| Upstream source | `/Users/roger/Project/develop/foundation-x402/x402` | Latest reviewed end, inclusive: `ea2cd8177d0b694945fcd3c69e962ad880e8cab0` | 2026-07-13 |
| Target fork | `/Users/roger/Project/develop/x402` | HEAD examined for this supplement: `ab923e64c109b5732e1286a3c08fe3845b1daa2c` | 2026-07-09 |

Supplement range examined:

```text
2b74587b29bd7d986c4c562e46444d74606b0e1d..ea2cd8177d0b694945fcd3c69e962ad880e8cab0
```

The supplement range contains 14 commits, 681 changed files, 13,277 insertions, and 43,732 deletions. Most churn is the upstream website deprecation and release bookkeeping, not reusable TypeScript SDK logic.

Commits reviewed:

```text
ea2cd8177d0b694945fcd3c69e962ad880e8cab0  2026-07-13  docs(facilitators): add Solvador to facilitators list (#2757)
0a604079aca7b5a45a2e1620ba444e13982646c8  2026-07-10  fix e2e exit hang (#2830)
2aa22d3e6a38547a8232737599d9f519c9ac5533  2026-07-10  chore(go): release (#2829)
7301f6c553a7b4c2e12f19ef6683d8c2e38f1fde  2026-07-10  chore: version typescript packages (#2828)
79bad65290ded008779de54f6ebf3b00ceb3f4db  2026-07-10  chore: version python package (#2827)
07bd44dc0126c612c9806069f7ee357d6e0a7922  2026-07-10  docs: clarify production facilitator guidance for mainnet EVM routes (#2824)
765990cc1aa053326ecbdbc34bac584561f9e234  2026-07-10  fix(python/fastapi): return 500 (and log) on unexpected settlement error (#2622)
f5070b98c4f9b4363cb0577d3f287a38aab36380  2026-07-10  fix flask 3xx response bug (#2826)
8b1abaeaef282e6307a2936b102c6d9223e61802  2026-07-08  docs(specs): add exact scheme spec for Casper Network (#2741)
d9bd02d151cb142e76769f3b6150e4ff625c3217  2026-07-08  feat(evm): add Igra mainnet (eip155:38833) default stablecoin (#2800)
f4530e2766c822a9c7f880e2a86484dd98257fb1  2026-07-08  fix(python/flask): use sync server in payment_middleware_from_config (#2810)
49706f061b2f5deee256c2129bca74629dcf0100  2026-07-07  Add Python support for builder-code extension (#2809)
29311c1076bcd447639ed62d2daf4dcfb037c699  2026-07-07  Builder code py (#2795)
7be420af0bd4a72f34f2290b42abc4ac1c5660ec  2026-07-07  Deprecate website (#2794)
```

## Repository relationship

The target is not a Git branch of upstream. It has an independent history and has been reorganized as a TypeScript-only fork with `@bankofai` package names, TRON support, network-driven wallet adapters, and other local API changes. Upstream commits should therefore be ported manually and tested; they should not be blindly cherry-picked.

## Recommended ports

### Required

1. `04860337caca929bdf9ccba69f2413d6d659e9a2` — emit the spec-compliant EVM `authorization_value_mismatch` error.
   - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Added `ErrAuthorizationValueMismatch` in `evm/src/exact/facilitator/errors.ts`, changed `eip3009.ts` to emit it instead of `ErrInvalidAuthorizationValue`, added the legacy `ErrorReasons` entry in `legacy/x402/src/types/verify/x402Specs.ts`, and updated the facilitator test assertion. EVM 710 tests pass, legacy 270 tests pass.

2. `a3ad102baa16d05440855214d43acf293cd0400f` — MCP interoperability fixes.
   - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Changed 7 optional fields in `core/src/schemas/index.ts` from `.optional()` to `.nullish().transform(v => v ?? undefined)` (5 in `ResourceInfoSchema`, 1 in `PaymentRequiredV2Schema.error`, 1 in `PaymentPayloadV2Schema.resource`). Replaced `isPaymentRequired` with `parsePaymentRequired` in MCP client `extractPaymentRequiredFromObject` and `extractPaymentRequiredFromError`, and in `encoding.ts` `extractPaymentRequiredFromError`. Added 4 null-normalization tests in core schemas, 1 null-field auto-pay test in MCP client, and fixed the V2 fixture in `utils.test.ts` (`maxAmountRequired` → `maxTimeoutSeconds`). Core 510 tests pass (1 pre-existing network failure), MCP 99 tests pass.

### High priority

3. `59ac597de8e3c15be6249dbba7aa5b7f08e0f47e` — dynamic extension info fields.
   - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Added `dynamicInfoFields?: string[]` to `ResourceServerExtension` in `core/src/types/extensions.ts`. Added `omitFields()` helper in `core/src/server/x402ResourceServer.ts` and applied it to echo validation so dynamic fields are excluded from `extensionInfoMatchesAdvertised`. Declared `["offers"]` in `offer-receipt/server.ts` and `["nonce", "issuedAt", "expirationTime"]` in `sign-in-with-x/server.ts`. Added 3 tests in core resource server and 2 tests in SIWX extension (incl. end-to-end fresh-nonce echo validation). Core 513 tests pass, extensions 471 tests pass.

4. `4cba2622badce62585ab4a41b3cb7a291ef96621` — EVM wallet compatibility and signature-verification hardening.
  - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Added 3 new shared files: `verifySignature.ts` (strict EOA/ERC-1271 verification primitive + `classifyErc6492Payer`), `erc7702.ts` (delegation detection), `revert.ts` (contract revert vs RPC failure). Replaced `signer.verifyTypedData` with `verifyTypedDataSignature` in 6 facilitators (exact eip3009, exact permit2, upto permit2, v1 scheme, batch-settlement deposit-eip3009, deposit-permit2) + `verifyBatchSettlementVoucherTypedData`. Rewrote `verifyEIP3009` to use `classifyErc6492Payer` + counterfactual factory allowlist gate. Added `simulateEip3009TransferResult`, deploy receipt status check, inner-signature extraction for settle, and `errorMessage` preservation. Added counterfactual ERC-6492 deposit support to batch-settlement (`Erc3009DepositVerifyResult`, `simulateCounterfactualErc3009Deposit`, `tryDeployCounterfactualErc3009Deposit`). Added `BatchSettlementEvmSchemeConfig` with `eip6492AllowedFactories`. Ported 3 new test files + 4 modified test files (mock signer adapted with `rcWithSig` helper). EVM 738 tests pass.

5. `f4c532e8` — EVM `validAfter` time-window correction.
   - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Changed `(now - 600).toString()` / `BigInt(now - 600)` to `"0"` / `BigInt(0)` across 9 source files (EVM: 5, Tron: 4) and 3 test files. The original "Already represented" assessment was incorrect — the target still used the old `now - 600` behavior before this port.

6. `8f22db34` — `Retry-After` handling.
   - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Changed `computeRetryDelay()` in `core/src/http/httpFacilitatorClient.ts` from `Number()` + `isNaN` to `trim()` + `/^\d+$/` regex. The original "Already represented" assessment was incorrect — the target still used the old `Number()` parsing before this port.

### Conditional

7. `266b19d2251356ee958a1f4ffaa4e57aa2007f33` — optional Batch Settlement facilitator receiver authorizer.
  - ✅ **Ported on branch `sync/upstream-2026-07`** (2026-07-13). Added `validateFacilitatorSupport?()` to `SchemeNetworkServer` in `core/src/types/mechanisms.ts` and wired `validateFacilitatorCapabilities()` into `x402ResourceServer.initialize()`. Made `authorizerSigner` optional in EVM + Tron facilitator schemes (`getExtra()` returns `undefined` when absent). Added `ErrAuthorizerNotConfigured` guard in EVM + Tron `claim.ts` and `refund.ts`. Added `validateFacilitatorSupport()` to EVM + Tron server schemes. Core 516 tests pass (+3), EVM 747 tests pass (+9), Tron 152 tests pass.

8. `ef7db6793791ca86c209113073ecdc4e480e5eec` — EVM client signer type clarification.
   - Review semantics only. The target's wallet interfaces have diverged, so the upstream patch should not be applied directly.

9. `d9bd02d151cb142e76769f3b6150e4ff625c3217` — Igra mainnet `eip155:38833` default stablecoin.
   - The target's `typescript/packages/mechanisms/evm/src/shared/defaultAssets.ts` does not include Igra.
   - Port only if BankofAI wants to advertise Igra EVM support. The upstream asset is USDC at `0xA5b8BF902b2844dA17d4506cc827F7F1681735E7`, decimals `6`, `assetTransferMethod: "permit2"`, and no EIP-2612 support flag.
   - This is a small registry/doc change, not a behavioral compatibility fix.

## Already represented in the target

No additional port is currently required for:

- `238fac45` — Mezo mainnet default asset. ✅ Verified: target has `eip155:31612` (Mezo USD, permit2) in `defaultAssets.ts`.
- `53040052` — XDC mainnet and Apothem defaults. ✅ Verified: target has `eip155:50` (XDC USDC) and `eip155:51` (Apothem USDC) in `defaultAssets.ts`.
- `ae0bf9be` — Builder Code `s` array support. ✅ Verified: target has `s?: string | string[]` in `builder-code/types.ts`.
- `edc7280c` — partial-settlement convention; the target already overrides settlement requirements with the metered amount. ✅ Verified: target's `upto/facilitator/permit2.ts` supports metered-amount settlement via `buildUptoPermit2SettleArgs`. (Upstream commit also added 4 conformance tests not yet ported — low priority.)

From the 2026-07-13 supplement, no additional port is currently required for:

- `0a604079` — e2e exit-hang cleanup; upstream-specific `e2e/` harness changes do not map directly to the target fork's current layout.
- `29311c10` and `49706f06` — Python Builder Code support and docs. The earlier TypeScript Builder Code `s` array support remains the only TypeScript compatibility item already tracked above.
- `7301f6c5` — upstream TypeScript release/version bookkeeping. Do not port package version bumps or changelog entries directly into the BankofAI package namespace.

### Not previously tracked

- `10ccbdb2` — docs: replace dead `facilitator.x402.org` with `x402.org/facilitator` (#2787). README-only URL change in 5 files (bazaar, express, fastify, hono, next). Target still has old URL. Low priority — docs only, no runtime impact.


## Out of scope for this target

The target currently retains only EVM and TRON mechanisms. Do not port chain-specific additions for TON/TVM, Keeta, Concordium, NEAR, Hedera, Stellar, or XRPL unless the target's supported-chain scope changes.

Go/Python-only changes, upstream release commits, Mintlify/site changes, upstream CI maintenance, and example-only fixes were also excluded.

The 2026-07-13 supplement also excludes the upstream website deprecation (`7be420af`), Python HTTP middleware fixes (`f4530e27`, `765990cc`, `f5070b98`), Go/Python release commits (`2aa22d3e`, `79bad652`), Casper-only specs (`8b1abaea`), facilitator-list/docs-only updates (`07bd44dc`, `ea2cd817`), and upstream site/docs cleanup.

## Suggested implementation order

```text
04860337 -> a3ad102b -> 59ac597d -> 4cba2622 -> f4c532e8 -> 8f22db34 -> 266b19d2
```

Items `04860337` (authorization_value_mismatch), `a3ad102b` (MCP interop), `59ac597d` (dynamicInfoFields), `f4c532e8` (validAfter), `8f22db34` (Retry-After), `4cba2622` (wallet compatibility), and `266b19d2` (validateFacilitatorSupport) have been ported on branch `sync/upstream-2026-07`. If Igra support is desired, `d9bd02d1` can be handled independently because it is a registry-only EVM asset addition.

## Next comparison

For the next upstream review, use this upstream range:

```bash
git -C /Users/roger/Project/develop/foundation-x402/x402 log \
  ea2cd8177d0b694945fcd3c69e962ad880e8cab0..HEAD \
  --date=short --pretty=format:'%H%x09%ad%x09%s'
```

Before relying on this checkpoint, verify whether the recommended ports above have landed in the target. Record the new target HEAD and replace the upstream end commit only after the new range has been fully reviewed.
