# TRON `exact` Contribution — Deployment Readiness Check

> Status date: 2026-04-19
> Scope: **Permit2 path only** (eip3009 deferred — see §3)
> Purpose: confirm every contract the x402 TRON Permit2 contribution depends on is deployed, source-verified, and interface-compatible before the 3 PRs are submitted to `x402-foundation/x402`.

---

## 1. Summary

Scope decision: ship **Permit2 path only** in the first contribution. `eip3009` is deferred until TIP-3009 exists and a compatible TRC-20 is deployed.

| Item | Blocker? |
|---|---|
| `permit2` path on **mainnet** | **No** — Permit2 source-verified, byte-identical to Uniswap, 27k+ live txs |
| `permit2` path on **Nile** | **Soft** — Permit2 deployed but source not yet verified on TronScan |
| Permit2Helper (mainnet + Nile) | **Soft** — treated as optional in spec; facilitators can use `Permit2.allowance()` directly |
| TIP-712 standard | **No** — TIP-712 is `Final` in `tronprotocol/tips` |
| `eip3009` path | **Deferred to follow-up PR** — no TIP-3009, no TRC-20 implements `transferWithAuthorization` |
| TIP-3009 standard | **Not needed for this PR** — `eip3009` path is out of scope |

---

## 2. Permit2 / Permit2Helper — deployment check

Source repo: https://github.com/sun-protocol/sunswap-permit2

### Interface compatibility with Uniswap Permit2

Result of comparing `sun-protocol/sunswap-permit2@main` against `Uniswap/permit2@main`:

- EIP-712 domain, typehash strings, struct layouts, function signatures, nonce bitmap mechanics: **byte-identical**.
- `DOMAIN_SEPARATOR` uses `block.chainid` at full value (not truncated).
- No function renames, added params, or removed functions.
- Solidity pragma `^0.8.17` matches.

**Verdict:** a client signing `PermitTransferFrom` for EVM Permit2 and for SUN.io Permit2 produces identical EIP-712 digests modulo `chainId` + `verifyingContract`. No spec-level divergence.

### `Permit2Helper.checkPermit2Allowance`

Reads `IAllowanceTransfer.allowance()` and returns `false` if any of:
1. `lastAmount > currentAllowanceAmount`, or
2. `block.timestamp > expiration`, or
3. **`expiration - block.timestamp ≤ 200` seconds**.

Note: the 200 is **seconds**, not blocks. Earlier drafts called it "200-block buffer" — that is incorrect.

This helper has no EVM equivalent. It is an optional facilitator-side pre-flight check; x402 spec should either document it as optional or have facilitators read `allowance()` directly from Permit2 for full symmetry with EVM.

### On-chain deployment status (as of 2026-04-17, via TronScan API)

| Contract | Address | Network | Deployed | Source verified | Live traffic |
|---|---|---|:-:|:-:|:-:|
| Permit2 | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | Mainnet | 2025-12-27 | **Yes** (verify_status=2) | **27,588 txs** |
| Permit2Helper | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` | Mainnet | 2026-02-02 | **No** | 0 |
| Permit2 | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | Nile | 2025-12-02 | **No** | 0 |
| Permit2Helper | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` | Nile | 2026-02-03 | **No** | 0 |

Mainnet Permit2 is the only contract with verified source + live traffic.

### Action items for Permit2 path

- [ ] **Request SUN.io submit TronScan source-verification** for 3 un-verified contracts (soft gap — spec treats Helper as optional, so this does not block PR1):
  - Mainnet Permit2Helper
  - Nile Permit2
  - Nile Permit2Helper
- [x] **Spec treats Helper as optional** — facilitators can call `Permit2.allowance()` directly for full interface symmetry with EVM. Helper adds convenience + 200-second expiration buffer.
- [x] **Spec draft uses "200-second buffer"** (corrected).

---

## 3. `eip3009` path — DEFERRED to a follow-up PR

### Why deferred

The `eip3009` path requires the **token** to implement:
- `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`
- `authorizationState(address,bytes32) → bool`
- `DOMAIN_SEPARATOR()`, `name()`, `version()`

None of the tokens currently on TRON meet this bar:

| Token | Address | Network | Verified | `transferWithAuthorization`? |
|---|---|---|:-:|:-:|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | Mainnet | Yes | **No** (standard TRC-20 only) |
| USDT (Nile) | `TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj` | Nile | No | **No** (has Polygon-style `executeMetaTransaction` instead) |
| USDT (Shasta) | `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs` | Shasta | No | **No** (5 standard TRC-20 methods only) |
| USDD | `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` | Mainnet | Partial | **No** (WTRX-style wrapper, no 3009 interface) |

### Scope decision

The initial x402 TRON contribution ships **Permit2-only**. The `eip3009` path is documented in the spec as "not supported in this spec version" and will be added in a **follow-up PR** once both of the following land (they are independent of x402):

1. **TIP-3009 filed in `tronprotocol/tips`** (does not currently exist).
2. **At least one TRC-20 implementing `transferWithAuthorization` deployed and TronScan-source-verified** (does not currently exist).

Permit2 covers every existing TRC-20 (USDT, USDD, everything with standard `approve`), so nothing is gated on the `eip3009` path for real usage.

### Follow-up PR prerequisites (tracked but not blocking this contribution)

- [ ] Seed TIP-3009 draft in `tronprotocol/tips` (SUN.io / BofAI, separate thread from x402 PRs)
- [ ] Deploy ERC-3009-compatible TRC-20 test token on Nile and verify on TronScan
- [ ] Optional: deploy on mainnet once Nile-tested
- [ ] Open follow-up x402 spec PR to add `assetTransferMethod: "eip3009"` to `scheme_exact_tron.md`

---

## 4. TIP standards check

### TIP-712 (EIP-712 on TRON) — required for both paths

- **Status:** `Final`
- **File:** [`tronprotocol/tips/tip-712.md`](https://github.com/tronprotocol/tips/blob/master/tip-712.md)
- **Created:** 2022-07-25
- Encoding / hashing / signing mechanics identical to EIP-712, adjusted for TRON's address prefix and chain ID format.

**Action:** none. Reference TIP-712 in the spec instead of just "TRON's EIP-712 equivalent".

### TIP-3009 (transferWithAuthorization on TRON) — does not exist

- Searched `tronprotocol/tips` — no file, no PR, no issue mentioning ERC-3009 or `transferWithAuthorization`.
- TRON has ported several EIPs (3855, 6049, 5656, 1153, 4844) but 3009 is not among them.

**Options:**

- **(a) Ignore.** State in the spec "on-chain interface is byte-identical to EIP-3009; TRON has no formal TIP, but the signing format follows TIP-712." Acceptable but will draw reviewer questions.
- **(b) Seed a TIP-3009 draft.** File a PR to `tronprotocol/tips` in parallel with the x402 PR1. Makes the x402 spec reference a real TIP number. Adds ~1 week of coordination work but strengthens the contribution.
- **(c) Wait for TRON Foundation to issue one.** Not in anyone's roadmap; will not happen on its own.

**Recommendation: (b).** BofAI / SUN.io has the standing to seed the TIP. The draft can be a thin wrapper that says "TRC-3009 is the on-chain interface identical to EIP-3009, signed via TIP-712" — most of the content is already in the x402 spec draft.

### Action items for TIP standards

- [ ] Reference TIP-712 by number (not "EIP-712 equivalent") throughout the x402 spec.
- [ ] **Decide (a) / (b) / (c).** Recommendation: (b) — seed a TIP-3009 draft to `tronprotocol/tips` in parallel with x402 PR1. Low incremental effort, meaningful signal.

---

## 5. Pre-submission checklist (Permit2-only scope)

Before opening x402-foundation Issue + PR1:

- [x] Scope narrowed to Permit2 path only — `eip3009` deferred to follow-up PR
- [x] `ISSUE_DRAFT.md` and `PR1_SPEC_DRAFT.md` rewritten for Permit2-only scope
- [x] 200-**second** Helper buffer (not 200-block) corrected in spec
- [x] TIP-712 referenced by number in spec (was "EIP-712 equivalent")
- [x] Shasta removed from supported networks (Nile is the only TRON testnet)
- [x] Helper noted as optional — facilitators can call `Permit2.allowance()` directly
- [ ] Request SUN.io submit TronScan source verification for 3 un-verified contracts (not a hard blocker for PR1 since Helper is optional and Nile Permit2 is testnet-only, but reviewers will appreciate it before PR2 lands)

Before opening PR2 (TypeScript):

- [ ] Nile Permit2 source-verified on TronScan (enables reviewer audit of integration test target)
- [ ] Optional: Mainnet Permit2Helper + Nile Permit2Helper source-verified

Before opening PR3 (Python):

- [ ] PR2 merged or clearly on path to merge

Follow-up PR (add `eip3009` path) — timing independent of this contribution:

- [ ] TIP-3009 filed in `tronprotocol/tips`
- [ ] ERC-3009-compatible TRC-20 deployed on Nile + TronScan-verified
- [ ] Spec PR adding `assetTransferMethod: "eip3009"` opened
