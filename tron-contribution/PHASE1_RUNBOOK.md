# Phase 1 Runbook — Issue + PR1 (Spec)

> **Goal:** open a GitHub Issue and PR1 (spec-only) on `x402-foundation/x402` to propose adding the TRON `exact` scheme (Permit2 + eip3009 dual-path).
> **Scope:** this runbook covers Phase 1 **only**. PR2 (TypeScript) and PR3 (Python) are separate phases.
> **Identity:** `BankofAI` (SUN.io ecosystem).
> **Status date:** 2026-04-20.

---

## 0. Phase overview

| Phase | Deliverable | Blocker |
|---|---|---|
| **Phase 1 (this doc)** | Issue + PR1 spec | — |
| Phase 2 | PR2 TypeScript `@x402/tron` | Phase 1 merged or clearly on-path + Nile ERC-3009 test token deployed |
| Phase 3 | PR3 Python `x402[tron]` | Phase 2 merged or on-path |

Phase 1 is **pure documentation** — no runtime code, no tests. The only files touched in PR1 are:

- `specs/schemes/exact/scheme_exact_tron.md` (new)
- `specs/schemes/exact/scheme_exact.md` (append TRON section)

---

## 1. Pre-submission preparation

### 1.1 Identity

- [ ] Confirm `gh` CLI is authenticated as `BankofAI` (not a personal account)
  ```bash
  gh auth status
  # if wrong account:
  gh auth switch
  # or:
  gh auth login
  ```
- [ ] Confirm local git author matches BankofAI identity
  ```bash
  git config user.name
  git config user.email
  # set per-repo if needed:
  git -C <path-to-x402-fork> config user.name "BankofAI"
  git -C <path-to-x402-fork> config user.email "<bofai-email>"
  ```
- [ ] **GPG/SSH signing configured** — Foundation requires signed commits for merge
  ```bash
  git config --global commit.gpgsign true
  git config --global user.signingkey <key-id>
  # verify:
  git -C <path> log --show-signature -1
  ```

### 1.2 Fork upstream

- [ ] Fork `x402-foundation/x402` to the `BankofAI` org via GitHub UI (or `gh repo fork x402-foundation/x402 --org BankofAI`)
- [ ] Clone locally in a **separate directory** from this planning repo. Replace `<FORK_DIR>` with any path you prefer:
  ```bash
  gh repo clone BankofAI/x402 <FORK_DIR>
  cd <FORK_DIR>
  git remote add upstream https://github.com/x402-foundation/x402.git
  git fetch upstream
  git checkout -b feature/tron-exact-spec upstream/main
  ```

### 1.3 Soft pre-requisites (recommended before PR1, not hard blockers)

- [ ] SUN.io TronScan source verification for 3 unverified Permit2 contracts:
  - Mainnet Permit2Helper `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL`
  - Nile Permit2 `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx`
  - Nile Permit2Helper `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h`
  - Source repo: https://github.com/sun-protocol/sunswap-permit2
  - Verification portal: https://tronscan.org/#/tools/contract/verify
  - *Why soft:* spec treats Helper as optional; mainnet Permit2 is already verified with 29k+ live txs. But reviewers will ask.

### 1.4 Placeholders to fill later (do NOT block PR1)

| Placeholder | Location | When to fill |
|---|---|---|
| `#<issue_number>` | PR1 description, `scheme_exact_tron.md` `Closes` line | Right after Issue is opened — edit PR body |
| `<BofAI x402 test USD on Nile>` address | `scheme_exact_tron.md` Appendix: Supported Tokens | Before PR1 merge — via follow-up commit |

Both are acceptable as TODOs in the initial PR submission.

---

## 2. Step-by-step execution

### Step A — Open Issue

**Target:** `x402-foundation/x402` → Issues → New Issue

**Title:** `[Proposal] Add TRON exact scheme — Permit2 + ERC-3009 via TIP-712`

**Labels:** `enhancement`, `new-chain`

**Body:** copy from [ISSUE_DRAFT.md](ISSUE_DRAFT.md) starting at the line "### Problem" (line 111 through end of file).

```bash
# via CLI:
gh issue create \
  --repo x402-foundation/x402 \
  --title "[Proposal] Add TRON exact scheme — Permit2 + ERC-3009 via TIP-712" \
  --label "enhancement,new-chain" \
  --body-file <(sed -n '111,$p' tron-contribution/ISSUE_DRAFT.md)
```

After creation:
- [ ] Note the issue number (e.g., `#1612`)
- [ ] Post a comment linking to the upcoming PR1 branch once it's pushed

### Step B — Prepare PR1 branch

Let `<FORK_DIR>` be the local clone of `BankofAI/x402` and `<PLANNING_DIR>` be the local clone of this planning repo (the one containing `tron-contribution/`).

1. **Create the spec file:**
   ```bash
   # run from anywhere; paths are absolute via the two variables above:
   sed -n '96,338p' <PLANNING_DIR>/tron-contribution/PR1_SPEC_DRAFT.md \
     | sed '1d;$d' \
     > <FORK_DIR>/specs/schemes/exact/scheme_exact_tron.md
   # (strips the surrounding ```markdown ... ``` fence)
   ```

2. **Patch the scheme index:**
   - Open `<FORK_DIR>/specs/schemes/exact/scheme_exact.md`
   - Find the `### Stellar` section
   - Append the TRON section from [PR1_SPEC_DRAFT.md](PR1_SPEC_DRAFT.md) lines 347-358

3. **Commit (signed):**
   ```bash
   cd <FORK_DIR>
   git add specs/schemes/exact/scheme_exact_tron.md specs/schemes/exact/scheme_exact.md
   git commit -S -m "specs(exact): add TRON exact scheme specification

   Adds the scheme specification for the exact payment scheme on TRON,
   covering both assetTransferMethod variants already defined by the EVM
   spec: permit2 and eip3009. No runtime code; the @x402/tron TypeScript
   and Python implementations will follow in separate PRs after spec
   approval.

   Closes #<issue_number>
   "
   ```

4. **Push:**
   ```bash
   git push -u origin feature/tron-exact-spec
   ```

### Step C — Open PR1

**Target:** base `x402-foundation/x402:main` ← head `BankofAI/x402:feature/tron-exact-spec`

**Title:** `specs(exact): add TRON exact scheme specification`

**Body:** copy from [PR1_SPEC_DRAFT.md](PR1_SPEC_DRAFT.md) lines 26-91 (the `### Description` section through `### Checklist`). Replace `#<issue_number>` with the actual Issue number from Step A.

```bash
gh pr create \
  --repo x402-foundation/x402 \
  --base main \
  --head BankofAI:feature/tron-exact-spec \
  --title "specs(exact): add TRON exact scheme specification" \
  --body-file <(sed -n '26,91p' tron-contribution/PR1_SPEC_DRAFT.md | sed "s/#<issue_number>/#<ACTUAL_ISSUE_NUM>/g")
```

### Step D — Post-submission

- [ ] Link PR1 in the Issue (comment: `PR1: <url>`)
- [ ] Monitor for reviewer feedback within 3–5 days
- [ ] Respond to every comment within 24 hours when possible
- [ ] Track pending items:
  - [ ] `<issue_number>` filled in PR1 description
  - [ ] Nile ERC-3009 test token deployed + verified (before PR1 merge)
  - [ ] Spec address placeholder `<BofAI x402 test USD on Nile>` replaced (follow-up commit to same branch)
  - [ ] SUN.io verifies the 3 un-verified Permit2 contracts on TronScan

---

## 3. Documents you'll use

All live under `tron-contribution/` in this planning repo. Do **not** submit these files to x402-foundation — they are internal planning artifacts. Only the derived content (Issue body, spec file, scheme index patch) goes upstream.

| File | Role in Phase 1 |
|---|---|
| [ISSUE_DRAFT.md](ISSUE_DRAFT.md) | **Source for Issue body.** Copy lines 111–end into the GitHub Issue. |
| [PR1_SPEC_DRAFT.md](PR1_SPEC_DRAFT.md) | **Source for PR1.** Lines 26–91 = PR body; lines 96–338 = `scheme_exact_tron.md`; lines 346–358 = `scheme_exact.md` append. |
| [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md) | **Internal reference.** Contract deployment + TIP standards status; don't attach to the PR, but reviewers may ask questions answered here. |
| [TRON_PROPOSAL.md](TRON_PROPOSAL.md) | **Background.** High-level proposal predating the draft split; kept for context. |
| [TRON_CONTRIBUTION_ANALYSIS.md](TRON_CONTRIBUTION_ANALYSIS.md) | **Background.** Architecture analysis — why independent package, risks of extending `@x402/evm`. |
| [TRON_CONTRIBUTION_IMPL.md](TRON_CONTRIBUTION_IMPL.md) | **Phase 2/3 material.** Implementation plan, not used in Phase 1. |
| [TRON_CONTRIBUTION_CODE.md](TRON_CONTRIBUTION_CODE.md) | **Phase 2 material.** Code skeletons for `@x402/tron`, not used in Phase 1. |
| [PHASE1_RUNBOOK.md](PHASE1_RUNBOOK.md) | **This file.** |

---

## 4. Full Phase 1 checklist

Track progress here. Check off as each item completes.

### Pre-submission
- [ ] `gh` authenticated as `BankofAI`
- [ ] Git signing key configured, verified with a test signed commit
- [ ] Fork `x402-foundation/x402` to `BankofAI` org
- [ ] Local clone of fork (`<FORK_DIR>`) in a directory separate from the planning repo, with `upstream` remote added

### Soft pre-requisites (recommended)
- [ ] SUN.io verifies Mainnet Permit2Helper on TronScan
- [ ] SUN.io verifies Nile Permit2 on TronScan
- [ ] SUN.io verifies Nile Permit2Helper on TronScan

### Issue
- [ ] Open Issue with title `[Proposal] Add TRON exact scheme — Permit2 + ERC-3009 via TIP-712`
- [ ] Labels: `enhancement`, `new-chain`
- [ ] Body pasted from `ISSUE_DRAFT.md` lines 111–end
- [ ] Issue number recorded: `#____`

### PR1 branch
- [ ] Branch `feature/tron-exact-spec` created from `upstream/main`
- [ ] `specs/schemes/exact/scheme_exact_tron.md` created with full content from `PR1_SPEC_DRAFT.md` lines 96–338
- [ ] `specs/schemes/exact/scheme_exact.md` patched with TRON section from `PR1_SPEC_DRAFT.md` lines 347–358
- [ ] Commit is signed (verified with `git log --show-signature -1`)
- [ ] Branch pushed to `BankofAI/x402`

### PR1
- [ ] PR opened to `x402-foundation/x402:main`
- [ ] Title: `specs(exact): add TRON exact scheme specification`
- [ ] Body from `PR1_SPEC_DRAFT.md` lines 26–91, with `#<issue_number>` replaced
- [ ] PR URL recorded: `____`
- [ ] PR link posted as comment on the Issue

### During review (ongoing)
- [ ] Respond to reviewer comments within 24h when possible
- [ ] Fill `#<issue_number>` placeholder if not done yet
- [ ] BofAI deploys `x402 Test USD` ERC-3009-compatible TRC-20 on Nile
- [ ] TronScan-verify the test token
- [ ] Follow-up commit to fill `<BofAI x402 test USD on Nile>` placeholder in the spec

### Phase 1 done
- [ ] PR1 merged
- [ ] Proceed to Phase 2

---

## 5. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Maintainers prefer PR #1408's approach | Medium | Issue explicitly compares approaches; energy-payer argument is technically decisive. Offer to unify if @EruditeIntelligence is interested. |
| Maintainers ask for TIP-3009 first | Low–Medium | USDC precedent cited. If pushed, BofAI can seed a TIP-3009 draft in parallel (low effort). |
| Maintainers prefer staged paths (permit2 first, eip3009 later) | Low | If requested, drop eip3009 from the spec; reintroduce as a follow-up PR. PR1_SPEC_DRAFT.md structure makes this easy to split. |
| SUN.io TronScan verification delayed | Low | Mainnet Permit2 is already verified; others are testnet or optional helpers. PR1 doesn't hard-depend on them. |
| ERC-3009 TRC-20 deployment slips past PR1 merge | Low | Placeholder `<BofAI x402 test USD on Nile>` is acceptable in the spec; fill via follow-up commit before PR2 lands. |
| `BankofAI` account not in Foundation CLA system | Medium | Check https://cla.linuxfoundation.org/ or whatever the x402 Foundation uses. Complete CLA before or at PR submission. |

---

## 6. Quick-reference: key facts reviewers may ask

| Q | A |
|---|---|
| Why not fold TRON into `@x402/evm`? | Different address format (Base58 vs. 0x), SDK (TronWeb vs. viem), CAIP-2 namespace (`tron:` vs. `eip155:`), and no ERC-1271/ERC-6492/Multicall3. All 5 existing mechanism packages are independent. |
| Why both paths from day one? | Matches EVM `exact`. `permit2` covers every existing TRC-20; `eip3009` is the interface EVM uses first. Avoids a second spec PR. |
| Why no TIP-3009 dependency? | USDC precedent: Circle shipped `transferWithAuthorization` in 2020, a year before EIP-3009 reached `Final`. The on-chain ABI is well-established; TIP-712 (Final) provides the signing layer. |
| Why is Permit2 safe to use? | Byte-identical fork of Uniswap Permit2; mainnet deployment is TronScan-verified with ~29k live txs. `DOMAIN_SEPARATOR` uses `block.chainid` at full value. |
| What about PR #1408? | Different approach (client signs full TRON tx). Energy payer is the client in #1408 (TRON debits `owner_address` of the signed tx); in this proposal the facilitator is `owner_address` and pays. Preserves EVM's gasless-client UX property. |
| What's Shasta's status? | Excluded. Lags Nile on features, doesn't allow external nodes. Nile is the recommended TRON testnet. |
| TRC-20 approval sponsoring? | Not available. TRC-20's `approve()` requires `msg.sender` to be the token owner. Permit2 fallback is two layers (EIP-2612 `permit` → manual user `approve`), not three. |
