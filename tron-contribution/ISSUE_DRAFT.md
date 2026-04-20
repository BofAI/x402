# Issue Draft — [Proposal] Add TRON exact scheme (Permit2 path)

> **Target repo:** `x402-foundation/x402`
> **Issue title:** `[Proposal] Add TRON exact scheme — Permit2 path (SUN.io Permit2)`
> **Labels:** `enhancement`, `new-chain`
> **Author identity:** BankofAI (SUN.io ecosystem)

---

## Scope note

This proposal covers the **Permit2 path only** for the `exact` scheme on TRON.

The `eip3009` path is intentionally **out of scope for this contribution**. It requires both (a) a formal TIP-3009 standard (which does not exist yet — no such file in `tronprotocol/tips`) and (b) at least one TRC-20 that implements `transferWithAuthorization` (none exists today on mainnet, Nile, or Shasta). These are independent work items that we can pursue in a follow-up PR once TIP-3009 is drafted and a compatible token is deployed + source-verified.

Starting with Permit2-only gets TRON to parity with EVM for every existing TRC-20 (USDT, USDD, any TRC-20 with standard `approve`) without blocking on new standards work.

---

## Problem

TRON has 200M+ active accounts and is the largest USDT settlement network by transaction volume. Currently, x402 has no TRON support, which means agents and services on TRON cannot participate in the x402 payment ecosystem.

## Proposed solution

Add `exact` scheme support for TRON with `assetTransferMethod: "permit2"` only. The Permit2 implementation we use is SUN.io's production deployment — an open-source, byte-identical fork of Uniswap Permit2 adapted to TIP-712:

- Source code: https://github.com/sun-protocol/sunswap-permit2
- Mainnet Permit2: `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` (verified on TronScan, 27k+ txs)
- Nile Permit2: `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx`

A client signing `PermitTransferFrom` for EVM Permit2 and for SUN.io Permit2 produces identical EIP-712 digests modulo `chainId` and `verifyingContract`. There is no divergence in typehash, struct layout, or nonce mechanics. This means the x402 `exact.permit2` payload structure works unchanged on TRON.

### Why an independent `@x402/tron` package (not inside `@x402/evm`)

TRON and EVM differ at the addressing and SDK layer even though the Permit2 signing semantics are identical:

| | EVM | TRON |
|---|---|---|
| Address format | `0x` hex (checksummed) | Base58Check (`T...`) |
| Chain SDK | viem / ethers | TronWeb |
| CAIP-2 namespace | `eip155:` | `tron:` |
| Chain ID source | embedded in CAIP-2 (`eip155:8453` → `8453`) | lookup table (`tron:mainnet` → `728126428`) |
| Smart wallet / ERC-1271 | supported | not available |
| ERC-6492 undeployed wallets | supported | not available |
| Multicall3 | available | not available |

Folding this into `@x402/evm` would require either widening `ClientEvmSigner['address']` from `` `0x${string}` `` to `string` (losing type safety for every EVM user) or a generic rewrite of the signer abstraction. The existing pattern — 5/5 of the current mechanism packages (`evm`, `svm`, `avm`, `aptos`, `stellar`) are independent — already answers this question.

## Working proof

BofAI has shipped a production TRON x402 SDK (`bankofai-x402`). Interop with the Coinbase x402 official client/server was validated on BSC testnet in April 2026. The Permit2 path specifically has been exercised through SUN.io's DEX in mainnet production (27k+ transactions against the Permit2 deployment).

## Supported networks (this PR)

| Network | CAIP-2 | Chain ID | Permit2 deployed? |
|---|---|---|:-:|
| TRON Mainnet | `tron:mainnet` | `728126428` | Yes, verified, live |
| TRON Nile | `tron:nile` | `3448148188` | Yes |

Shasta is intentionally excluded — it lags Nile on features and does not allow external nodes; Nile is the recommended TRON testnet.

## Contribution workflow

Per `CONTRIBUTING.md` §"Adding a new chain", we will submit this in three PRs:

1. **PR1 — Spec.** `specs/schemes/exact/scheme_exact_tron.md` + a TRON section added to `specs/schemes/exact/scheme_exact.md`. No runtime code.
2. **PR2 — TypeScript.** `typescript/packages/mechanisms/tron/` (`@x402/tron`) with client, server, and facilitator implementations for the Permit2 path, unit tests, and a Nile testnet integration test.
3. **PR3 — Python.** `python/x402/mechanisms/tron/` with matching implementation, using `tronpy`.

We are opening this Issue first so the Foundation can weigh in on direction before any of the three PRs land.

## Future work (not in this PR)

- **`eip3009` path.** Will follow once (a) a TIP-3009 standard exists in `tronprotocol/tips`, and (b) at least one TRC-20 implementing `transferWithAuthorization` is deployed and source-verified. We plan to seed the TIP-3009 draft ourselves in a separate thread with TRON Foundation.
- **Shasta support.** Can be added later if there is demand; skipping for now.

## Open questions for Foundation maintainers

1. **Package naming.** We are proposing `@x402/tron`, matching the `@x402/{evm,svm,avm,aptos,stellar}` pattern. Please confirm.
2. **Permit2 scope.** We are proposing `assetTransferMethod: "permit2"` only for the initial PR. Please confirm this is acceptable (vs. requiring both paths up-front).
3. **TRON limitation on approval sponsoring.** TRC-20's `approve()` requires `msg.sender` to be the token owner, so the Permit2 fallback cannot include a facilitator-sponsored `approve()`. Our fallback ladder is two layers (EIP-2612 `permit` → manual user `approve`), not three. Noted in the spec.

---

## Issue body (copy-paste ready)

Everything below this line is the body that should be pasted into the GitHub Issue; everything above is context for internal review.

---

### Problem

TRON has 200M+ active accounts and is the largest USDT settlement network by transaction volume. Currently x402 has no TRON support, which means agents and services on TRON cannot participate in the x402 payment ecosystem.

### High-level approach

Add `exact` scheme support for TRON with `assetTransferMethod: "permit2"` only.

The Permit2 implementation is SUN.io's production deployment — an open-source, byte-identical fork of Uniswap Permit2 adapted to TIP-712 ([source](https://github.com/sun-protocol/sunswap-permit2)). A client signing `PermitTransferFrom` for EVM Permit2 and for SUN.io Permit2 produces identical EIP-712 digests modulo `chainId` + `verifyingContract`. No typehash, struct, or nonce-mechanism divergence from Uniswap.

- **Independent `@x402/tron` package.** TRON uses Base58 addresses, TronWeb SDK, and `tron:` CAIP-2 prefix, so it does not fit cleanly inside the EVM package.
- **3-PR workflow** per `CONTRIBUTING.md`:
  1. Spec: `specs/schemes/exact/scheme_exact_tron.md`
  2. TypeScript reference implementation (`@x402/tron`)
  3. Python implementation (`x402[tron]`)

### Why only Permit2 (not `eip3009`) in this PR

The `eip3009` path on TRON is blocked on two independent items that are not in scope for an x402 PR:

1. **No formal TIP-3009 standard.** `tronprotocol/tips` does not contain TIP-3009; TIP-712 does exist and is `Final`, which is sufficient for the Permit2 path.
2. **No TRC-20 implements `transferWithAuthorization`.** Verified for USDT (mainnet + Nile + Shasta) and USDD.

Starting with Permit2-only gets TRON to parity with EVM for every existing TRC-20 without blocking on upstream standards work. The `eip3009` path can be added in a follow-up PR once both items above land.

### Supported networks

| Network | CAIP-2 | Chain ID | Status |
|---|---|---|---|
| TRON Mainnet | `tron:mainnet` | `728126428` | Production — Permit2 deployed, verified, 27k+ live txs |
| TRON Nile | `tron:nile` | `3448148188` | Testnet — Permit2 deployed |

### Permit2 path

Uses SUN.io's production Permit2 contract — [open source](https://github.com/sun-protocol/sunswap-permit2), byte-compatible with Uniswap Permit2, adapted to TIP-712.

| Network | Permit2 | Permit2Helper (optional, for pre-flight checks) |
|---|---|---|
| Mainnet | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` (verified) | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` |
| Nile | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

`Permit2Helper.checkPermit2Allowance` is a SUN.io-specific convenience contract that checks amount + expiration + a 200-second expiration buffer; it has no EVM analogue. The spec will treat it as optional — facilitators can also call `Permit2.allowance()` directly for full interface symmetry with EVM.

### TRON-specific constraints

- **No approval sponsoring.** TRC-20's `approve()` requires `msg.sender` to be the token owner, so a facilitator cannot sponsor the `approve()` call. The Permit2 fallback ladder is two layers: EIP-2612 `permit` → manual user `approve` (not three).
- **No ERC-1271 / ERC-6492.** Signature verification is `ecrecover` only.
- **No Multicall3.** Facilitator diagnostics use sequential `triggerConstantContract` calls.
- **TIP-712** (`Final` status in `tronprotocol/tips`) is the formal TRON standard for EIP-712-style signing and is referenced by this spec.

### Checklist

- [ ] Maintainers confirm `@x402/tron` as the package name
- [ ] Maintainers confirm independent-package approach (vs. extending `@x402/evm`)
- [ ] Maintainers confirm Permit2-only scope is acceptable for initial PR
- [ ] Spec PR (PR1) opened
- [ ] TypeScript PR (PR2) opened
- [ ] Python PR (PR3) opened
