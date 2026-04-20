# Issue Draft — [Proposal] Add TRON exact scheme

> **Target repo:** `x402-foundation/x402`
> **Issue title:** `[Proposal] Add TRON exact scheme — Permit2 + ERC-3009 via TIP-712`
> **Labels:** `enhancement`, `new-chain`
> **Author identity:** BankofAI (SUN.io ecosystem)

---

## Scope

Full parity with EVM `exact` — both `assetTransferMethod` variants, with **payload schemas byte-identical to `scheme_exact_evm.md`** (same `permit2Authorization` / `authorization` / `witness` field names, same EIP-712 typehashes, same Witness pattern):

1. **`permit2` path** — uses SUN.io's production Permit2 deployment ([open source](https://github.com/sun-protocol/sunswap-permit2), byte-identical fork of Uniswap Permit2 adapted to TIP-712) + a TRON-deployed `x402ExactPermit2Proxy` (same Solidity source as the EVM reference contract, ported to TRON). Covers every existing TRC-20, including USDT and USDD.
2. **`eip3009` path** — `transferWithAuthorization` signed via TIP-712. Requires tokens to implement the ERC-3009 interface. BofAI will deploy an ERC-3009-compatible TRC-20 on Nile (and optionally mainnet) to provide a working implementation — following the USDC precedent of shipping the interface ahead of a formal standard document. **Intentionally not dependent on TIP-3009** — TIP-3009 does not exist in `tronprotocol/tips` today and can be proposed separately; the on-chain interface is well-established via EIP-3009 and the signing layer uses TIP-712 (`Final` status).

ERC-7710 (the third method in EVM spec) is not supported on TRON — no equivalent smart-account delegation framework.

Why both paths in the initial PR: gives TRON full parity with EVM `exact`, avoids a second spec PR, and provides the TRON ecosystem with a reference ERC-3009 TRC-20 + `x402ExactPermit2Proxy`.

---

## Relationship to existing PR #1408

PR [#1408](https://github.com/x402-foundation/x402/pull/1408) from @EruditeIntelligence proposes a different approach: the client signs a **complete TRON transaction** (`TriggerSmartContract` calling `transfer`), and the facilitator broadcasts it.

We are proposing an alternative approach that mirrors the EVM `exact` scheme architecture. Key differences:

| Aspect | #1408 approach | This proposal |
|---|---|---|
| Signed payload | Full TRON `TriggerSmartContract` tx | TIP-712 structured data (`PermitTransferFrom` or `TransferWithAuthorization`) |
| Who pays TRON energy | **Client** (`owner_address` = client; TRON debits energy from the signer) | **Facilitator** (facilitator is `owner_address` of the on-chain tx) |
| Alignment with EVM `exact` | Low (TRON-native pre-signed broadcast) | High (same `assetTransferMethod` structure, same EIP-712 semantics) |
| `assetTransferMethod` | Not applicable | `permit2` \| `eip3009` |
| Production usage at time of proposal | 2 on-chain settlements | SUN.io Permit2: 27,588 mainnet txs |

The energy-payer difference is material: x402's UX premise is that the client does not hold native gas tokens. The EVM `exact` scheme has the facilitator paying gas. The #1408 approach requires the client to hold TRX to pay energy/bandwidth, because TRON debits the `owner_address` of the signed tx. Our approach preserves the EVM gasless-client property on TRON.

We are filing this as a parallel Issue rather than comments on #1408 so the Foundation can evaluate the two approaches side by side. Happy to coordinate with @EruditeIntelligence if there is interest in unifying.

---

## Problem

TRON has 200M+ active accounts and is the largest USDT settlement network by transaction volume. Currently, x402 has no `exact` scheme support merged for TRON, which means agents and services on TRON cannot participate in the x402 payment ecosystem.

## Why an independent `@x402/tron` package (not inside `@x402/evm`)

TRON and EVM differ at the addressing and SDK layer even though the on-chain authorization interfaces are identical:

| | EVM | TRON |
|---|---|---|
| Address format | `0x` hex (checksummed) | Base58Check (`T...`) |
| Chain SDK | viem / ethers | TronWeb |
| CAIP-2 namespace | `eip155:` | `tron:` |
| Chain ID source | embedded in CAIP-2 (`eip155:8453` → `8453`) | lookup table (`tron:mainnet` → `728126428`) |
| Smart wallet / ERC-1271 | supported | not available |
| ERC-6492 undeployed wallets | supported | not available |
| Multicall3 | available | not available |

Folding this into `@x402/evm` would require widening `ClientEvmSigner['address']` from `` `0x${string}` `` to `string` — losing type safety for every EVM user. All 5 existing mechanism packages (`evm`, `svm`, `avm`, `aptos`, `stellar`) are independent; TRON should follow the same pattern.

## Working proof

- BofAI has shipped a production TRON x402 SDK (`bankofai-x402`). Interop with the Coinbase x402 official client/server was validated on BSC testnet in April 2026.
- SUN.io operates the Permit2 deployment with 27k+ mainnet transactions — `Permit2.permitTransferFrom` is in live use on TRON today.
- BofAI will deploy the ERC-3009-compatible TRC-20 reference token on Nile before PR2 and share the address + verified source.

## Supported networks

| Network | CAIP-2 | Chain ID | Status |
|---|---|---|---|
| TRON Mainnet | `tron:mainnet` | `728126428` | Production |
| TRON Nile | `tron:nile` | `3448148188` | Testnet (recommended for development) |

Shasta is intentionally excluded — it lags Nile on features and does not allow external nodes; Nile is the recommended TRON testnet.

## SUN.io Permit2 deployments

| Network | Permit2 | Permit2Helper (optional) |
|---|---|---|
| Mainnet | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` (TronScan-verified, ~27,588 live txs) | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` |
| Nile | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

Source code: https://github.com/sun-protocol/sunswap-permit2

Byte-identical to Uniswap Permit2: same typehashes, same struct layouts, same nonce bitmap mechanics, `DOMAIN_SEPARATOR` uses `block.chainid` at full value. No contract modifications required for x402 interop.

## Contribution workflow

Per `CONTRIBUTING.md` §"Adding a new chain", we will submit this in three PRs:

1. **PR1 — Spec.** `specs/schemes/exact/scheme_exact_tron.md` + a TRON section added to `specs/schemes/exact/scheme_exact.md`. No runtime code.
2. **PR2 — TypeScript.** `typescript/packages/mechanisms/tron/` (`@x402/tron`) with client, server, and facilitator implementations for both paths, unit tests, and a Nile testnet integration test.
3. **PR3 — Python.** `python/x402/mechanisms/tron/` with matching implementation, using `tronpy`.

## Open questions for Foundation maintainers

1. **Relationship to PR #1408.** Are maintainers open to evaluating both approaches in parallel? Or should one be prioritized?
2. **Package naming.** We are proposing `@x402/tron`, matching the `@x402/{evm,svm,avm,aptos,stellar}` pattern.
3. **Permit2-and-eip3009 scope in the initial PR.** We are proposing both paths up-front. Acceptable, or would the Foundation prefer them staged?
4. **TIP-3009 non-dependency.** We are following the USDC precedent (ship the ERC-3009 interface before a formal TIP document). Acceptable, or does the Foundation want a TIP-3009 draft filed in `tronprotocol/tips` first?
5. **TRON approval-sponsoring limitation.** TRC-20's `approve()` requires `msg.sender` to be the token owner, so the Permit2 path's fallback cannot include a facilitator-sponsored `approve()`. Our fallback is two layers (EIP-2612 `permit` → manual user `approve`), not three. Noted in the spec.

---

## Issue body (copy-paste ready)

Everything below this line is the body to paste into the GitHub Issue; everything above is context for internal review.

---

### Problem

TRON has 200M+ active accounts and is the largest USDT settlement network by transaction volume. Currently x402 has no `exact` scheme support merged for TRON, which means agents and services on TRON cannot participate in the x402 payment ecosystem.

### Relationship to PR #1408

PR #1408 from @EruditeIntelligence proposes a different approach: the client signs a complete TRON `TriggerSmartContract` transaction and the facilitator broadcasts it. This proposal is an alternative that mirrors the EVM `exact` scheme architecture (TIP-712 signed authorization + facilitator-constructed transaction).

The most material difference is the **energy payer**: in #1408 the client's account pays TRON energy/bandwidth (TRON debits the `owner_address` of the signed tx — who signs, pays). In this proposal, the facilitator is the `owner_address` of the on-chain tx, so the facilitator pays — matching x402's EVM gasless-client property.

We are filing this as a parallel Issue so the Foundation can evaluate both approaches side by side. Happy to coordinate with @EruditeIntelligence if there is interest in unifying.

### High-level approach

Add `exact` scheme support for TRON with **both** `assetTransferMethod` variants, matching EVM. **Payload schemas byte-identical to `scheme_exact_evm.md`** — same field names (`permit2Authorization`, `authorization`, `witness`), same EIP-712 typehashes, same Permit2 Witness pattern. Only the address format (Base58 in `paymentRequirements`) and the on-chain SDK (TronWeb) differ.

1. **`permit2`** — uses SUN.io's production Permit2 ([source](https://github.com/sun-protocol/sunswap-permit2)), a byte-identical fork of Uniswap Permit2, plus a TRON-deployed `x402ExactPermit2Proxy` (same Solidity as EVM reference) to enforce the Witness pattern. Covers every TRC-20.
2. **`eip3009`** — `transferWithAuthorization` signed via TIP-712 ([tip-712.md](https://github.com/tronprotocol/tips/blob/master/tip-712.md), `Final`). BofAI will deploy an ERC-3009-compatible TRC-20 on Nile (+ mainnet if demand) to provide a working implementation. Following USDC precedent, this ships the interface without a formal TIP-3009 document; a TIP-3009 can be proposed separately in `tronprotocol/tips`.

ERC-7710 (delegation) is not supported on TRON — no equivalent smart-account delegation framework.

Independent `@x402/tron` package — TRON uses Base58 addresses, TronWeb SDK, and `tron:` CAIP-2 prefix; doesn't fit inside the EVM package. All 5 existing mechanism packages are independent.

3-PR workflow per `CONTRIBUTING.md`:
1. Spec: `specs/schemes/exact/scheme_exact_tron.md`
2. TypeScript reference implementation (`@x402/tron`)
3. Python implementation (`x402[tron]`)

### Why both paths

- `permit2` covers every existing TRC-20 (including USDT, USDD) via a verified production Permit2 contract with ~27,588 live mainnet txs.
- `eip3009` is the native interface EVM `exact` uses first. Giving TRON an ERC-3009 reference implementation lowers the barrier for future TRON tokens to integrate natively without Permit2 round-trip.

### Supported networks

| Network | CAIP-2 | Chain ID |
|---|---|---|
| TRON Mainnet | `tron:mainnet` | `728126428` |
| TRON Nile | `tron:nile` | `3448148188` |

Shasta excluded: lags Nile on features, does not allow external nodes.

### Permit2 path

Uses SUN.io Permit2:

| Network | Permit2 | Permit2Helper (optional) |
|---|---|---|
| Mainnet | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` (verified, 27k+ txs) | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` |
| Nile | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

Byte-identical to Uniswap Permit2: typehashes, struct layouts, nonce bitmap all match; `DOMAIN_SEPARATOR` uses `block.chainid` at full value. `Permit2Helper.checkPermit2Allowance` is a SUN-specific convenience check (amount + expiration + 200-second buffer); x402 spec treats it as optional — facilitators can call `Permit2.allowance()` directly for full interface symmetry with EVM.

### eip3009 path

BofAI will deploy an ERC-3009-compatible TRC-20 on Nile before opening PR2. The deployed contract exposes `transferWithAuthorization`, `authorizationState`, `DOMAIN_SEPARATOR`, `name`, `version` byte-identical to EIP-3009. Signatures use TIP-712 with `chainId = block.chainid` (full value). The deployment address + TronScan-verified source will be added to the spec's "Supported Tokens" appendix before PR1 merges.

### TRON-specific constraints

- **No approval sponsoring.** TRC-20's `approve()` requires `msg.sender` to be the token owner. The Permit2 fallback is two layers (EIP-2612 `permit` → manual user `approve`), not three.
- **No ERC-1271 / ERC-6492.** Signature verification is `ecrecover` only.
- **No Multicall3.** Facilitator diagnostics use sequential `triggerConstantContract` calls.
- **TIP-712** (`Final` in `tronprotocol/tips`) is the formal signing standard this spec references.

### Checklist

- [ ] Maintainers confirm `@x402/tron` as the package name
- [ ] Maintainers confirm independent-package approach (vs. extending `@x402/evm`)
- [ ] Maintainers confirm dual-path (`permit2` + `eip3009`) scope for initial PR
- [ ] Maintainers weigh this proposal vs. #1408
- [ ] ERC-3009-compatible TRC-20 deployed on Nile + TronScan-verified
- [ ] `x402ExactPermit2Proxy` (TRON port of EVM reference) deployed on Nile + TronScan-verified
- [ ] Spec PR (PR1) opened
- [ ] TypeScript PR (PR2) opened
- [ ] Python PR (PR3) opened
