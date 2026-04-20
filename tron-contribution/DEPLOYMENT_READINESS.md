# TRON `exact` Contribution — Deployment Readiness Check

> Status date: 2026-04-20
> Scope: **Permit2 + eip3009 dual-path** (payload schema byte-identical to EVM `exact`)
> Purpose: confirm every contract and standard the x402 TRON contribution depends on is deployed or on a clear path to deployment, source-verified, and interface-compatible before the 3 PRs are submitted to `x402-foundation/x402`.

---

## 1. Summary

Scope: ship **both `assetTransferMethod` paths** from day one — `permit2` and `eip3009` — with payload schemas **byte-identical to `scheme_exact_evm.md`**. The `permit2` path uses the same `x402ExactPermit2Proxy` + Witness pattern as EVM, ported to TRON. No TIP-3009 dependency: follow USDC precedent (ship interface ahead of formal standard).

| Item | Blocker? |
|---|---|
| SUN.io `permit2` contract on **mainnet** | **No** — source-verified, byte-identical to Uniswap, 27k+ live txs |
| SUN.io `permit2` contract on **Nile** | **Soft** — deployed but source not yet verified on TronScan |
| Permit2Helper (mainnet + Nile) | **Soft** — treated as optional in spec; facilitators can use `Permit2.allowance()` directly |
| **`x402ExactPermit2Proxy` on Nile** | **Soft (PR2 blocker)** — BofAI/SUN.io must port EVM reference contract to TRON and deploy on Nile before PR2 integration tests |
| **`x402ExactPermit2Proxy` on Mainnet** | **Soft (recommended)** — not required for PR2 merge but expected for production launch |
| TIP-712 standard | **No** — TIP-712 is `Final` in `tronprotocol/tips` |
| `eip3009` path interface | **No** — on-chain ABI is byte-identical to EVM EIP-3009; TIP-712 provides signing layer |
| `eip3009` path test token | **Soft (PR2 blocker)** — BofAI must deploy ERC-3009-compatible TRC-20 on Nile before PR2 integration tests |
| TIP-3009 standard | **No (not a dependency)** — USDC shipped `transferWithAuthorization` before EIP-3009 was `Final`; we follow the same precedent |

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

### `x402ExactPermit2Proxy` — NEW deployment requirement

The EVM spec uses a canonical `x402ExactPermit2Proxy` contract (`0x402085c248EeA27D92E8b30b2C58ed07f9E20001`, CREATE2-deployed to the same address across all EVM chains) as the `spender` in Permit2 signatures. Its role is to enforce the Witness pattern: the user signs `(to, validAfter)` into the Permit2 witness and the proxy verifies `transferDetails.to == witness.to`, so the facilitator CANNOT change the destination.

**For `permit2` payload schema parity with EVM, TRON needs the same contract.** Two options:

- **Port the Solidity source** from [EVM reference §Annex](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md#reference-implementation-x402ExactPermit2Proxy) as-is. TRON's TVM is bytecode-compatible with most Solidity EVM output; the only adjustment is recompiling against SUN.io's Permit2 `ISignatureTransfer` interface (byte-identical to Uniswap's).
- **Deployment address:** TRON's CREATE2 does not guarantee same-address-across-networks, so addresses will differ per network. The spec Annex has per-network address placeholders.

**Action:** BofAI + SUN.io coordinate on deploying `x402ExactPermit2Proxy` to Nile (blocker for PR2) and optionally Mainnet (recommended before production). TronScan source-verification required.

### Action items for Permit2 path

- [ ] **Port + deploy `x402ExactPermit2Proxy` on Nile** — block for PR2 (integration test target)
- [ ] **Deploy `x402ExactPermit2Proxy` on Mainnet** — recommended before production launch, not strictly required for contribution merge
- [ ] **TronScan-verify** both Proxy deployments
- [ ] **Request SUN.io submit TronScan source-verification** for 3 un-verified Permit2-related contracts (soft gap — spec treats Helper as optional, so this does not block PR1):
  - Mainnet Permit2Helper
  - Nile Permit2
  - Nile Permit2Helper
- [x] **Spec treats Helper as optional** — facilitators can call `Permit2.allowance()` directly for full interface symmetry with EVM. Helper adds convenience + 200-second expiration buffer.
- [x] **Spec draft uses "200-second buffer"** (corrected).
- [x] **Spec draft aligns payload schema with EVM** — `permit2Authorization` + `witness` structure, matching `scheme_exact_evm.md`.

---

## 3. `eip3009` path — in scope, test token deployment required before PR2

### On-chain interface (ABI-level)

The `eip3009` path requires the **token** to implement:
- `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`
- `authorizationState(address,bytes32) → bool`
- `DOMAIN_SEPARATOR()`, `name()`, `version()`

This ABI is **byte-identical to EVM EIP-3009**. Signing uses TIP-712, which is already `Final` and produces domain-separated EIP-712 digests compatible with any ERC-3009 client/facilitator.

**No TIP-3009 is required.** USDC precedent: Circle deployed `transferWithAuthorization` on Ethereum mainnet in 2020, a year before EIP-3009 reached `Final` status. The on-chain interface predates and does not depend on a formal standard. x402 validates the ABI directly at the facilitator layer.

### Current TRC-20 inventory

None of the tokens currently on TRON meet the ERC-3009 interface bar:

| Token | Address | Network | Verified | `transferWithAuthorization`? |
|---|---|---|:-:|:-:|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | Mainnet | Yes | **No** (standard TRC-20 only) |
| USDT (Nile) | `TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj` | Nile | No | **No** (has Polygon-style `executeMetaTransaction` instead) |
| USDD | `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` | Mainnet | Partial | **No** (WTRX-style wrapper, no 3009 interface) |

**Implication:** the `eip3009` path is ready at the *code* layer, but until an ERC-3009-compatible TRC-20 is deployed on Nile, PR2 integration tests cannot exercise it end-to-end. PR1 (spec) is not affected.

### Action items for eip3009 path

- [ ] **Deploy ERC-3009-compatible TRC-20 on Nile** (BofAI) — a minimal mintable test token implementing the USDC/EIP-3009 interface, TIP-712 domain, source-verified on TronScan. Required before PR2 integration tests land. Mainnet deployment not required for contribution; real stablecoin issuers (Tether, Circle) are the intended long-term adopters of the interface on their tokens.
- [x] **Spec documents both paths from day one** — no staged rollout.
- [x] **No TIP-3009 dependency** — spec references USDC precedent explicitly.

---

## 4. TIP standards check

### TIP-712 (EIP-712 on TRON) — required for both paths

- **Status:** `Final`
- **File:** [`tronprotocol/tips/tip-712.md`](https://github.com/tronprotocol/tips/blob/master/tip-712.md)
- **Created:** 2022-07-25
- Encoding / hashing / signing mechanics identical to EIP-712, adjusted for TRON's address prefix and chain ID format.

**Action:** none. Reference TIP-712 in the spec instead of just "TRON's EIP-712 equivalent".

### TIP-3009 (transferWithAuthorization on TRON) — not a dependency

- Searched `tronprotocol/tips` — no file, no PR, no issue mentioning ERC-3009 or `transferWithAuthorization`.
- TRON has ported several EIPs (3855, 6049, 5656, 1153, 4844) but 3009 is not among them.
- **This does not block the contribution.** EIP-3009 itself was `Final`-ized in 2021, *after* USDC shipped the interface in production in 2020. x402's `eip3009` path validates the ABI at the token layer, not a standards doc.

**Optional follow-up (not required for this contribution):** BofAI / SUN.io may seed a TIP-3009 draft in `tronprotocol/tips` as a thin wrapper saying "TRC-3009 is the on-chain interface identical to EIP-3009, signed via TIP-712" — this would formalize the reference but is not a prerequisite for merging any of the 3 x402 PRs.

### Action items for TIP standards

- [ ] Reference TIP-712 by number (not "EIP-712 equivalent") throughout the x402 spec.
- [ ] Optional follow-up: seed TIP-3009 draft in `tronprotocol/tips`. Not blocking.

---

## 5. Pre-submission checklist

Before opening x402-foundation Issue + PR1 (spec):

- [x] Scope covers both `permit2` and `eip3009` paths — matches EVM `exact`
- [x] `ISSUE_DRAFT.md` and `PR1_SPEC_DRAFT.md` cover both paths with payload examples
- [x] 200-**second** Helper buffer (not 200-block) corrected in spec
- [x] TIP-712 referenced by number in spec (was "EIP-712 equivalent")
- [x] Shasta removed from supported networks (Nile is the only TRON testnet)
- [x] Helper noted as optional — facilitators can call `Permit2.allowance()` directly
- [x] No TIP-3009 dependency — USDC precedent cited for shipping interface ahead of standard
- [ ] Request SUN.io submit TronScan source verification for 3 un-verified contracts (not a hard blocker for PR1 since Helper is optional and Nile Permit2 is testnet-only, but reviewers will appreciate it before PR2 lands)

Before opening PR2 (TypeScript):

- [ ] **Deploy `x402ExactPermit2Proxy` on Nile** + TronScan-verify — required for `permit2` integration tests and Witness-pattern enforcement
- [ ] **Deploy ERC-3009-compatible TRC-20 test token on Nile** + TronScan-verify — required for `eip3009` integration tests
- [ ] Nile Permit2 source-verified on TronScan (enables reviewer audit of integration test target)
- [ ] Optional: Mainnet `x402ExactPermit2Proxy` + Mainnet Permit2Helper + Nile Permit2Helper source-verified

Before opening PR3 (Python):

- [ ] PR2 merged or clearly on path to merge
- [ ] Same Nile test token used as in PR2 (shared fixture)
