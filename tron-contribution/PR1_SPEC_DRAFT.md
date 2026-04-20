# PR1 Draft — TRON exact scheme specification (Permit2 path)

> **Target repo:** `x402-foundation/x402`
> **Branch:** `feature/tron-exact-spec` (to be created from upstream `main`)
> **PR title:** `specs(exact): add TRON exact scheme specification (Permit2 path)`
> **Depends on:** Issue #<issue_number> (will be filled in after Issue is opened)

This PR adds the specification only. Scope is **Permit2 path only**; the `eip3009` path is deferred to a follow-up PR (see Scope note below). No SDK/runtime code in this PR. Implementation PRs (PR2 TypeScript, PR3 Python) follow after spec review.

---

## Scope note

This spec covers `assetTransferMethod: "permit2"` only. The `eip3009` path is intentionally **not** included because:

- `tronprotocol/tips` does not contain TIP-3009 — no formal TRON standard for `transferWithAuthorization` exists yet.
- No TRC-20 on mainnet, Nile, or Shasta currently implements `transferWithAuthorization`. Verified: USDT mainnet, USDT Nile (`TXLAQ...`), USDT Shasta, USDD.

Both items above can be resolved independently of x402 — a TIP-3009 proposal can be filed in `tronprotocol/tips`, and a compatible TRC-20 can be deployed — and when they land, the `eip3009` path will be added in a follow-up spec PR.

Permit2-only is sufficient for USDT, USDD, and every existing TRC-20 to participate in x402 `exact`.

---

## Files changed in this PR

| File | Status | Purpose |
|---|---|---|
| `specs/schemes/exact/scheme_exact_tron.md` | **new** | Full TRON `exact` spec — Permit2 path only |
| `specs/schemes/exact/scheme_exact.md` | modified | Append TRON section to the scheme index and critical-validation checklist |

No code, examples, or tests are changed.

---

## PR body (copy-paste ready)

### Description

Adds formal specification for the `exact` payment scheme on TRON, scoped to `assetTransferMethod: "permit2"` only.

Closes #<issue_number>.

- Adds `specs/schemes/exact/scheme_exact_tron.md` — TRON `exact` spec, Permit2 path.
- Updates `specs/schemes/exact/scheme_exact.md` — appends TRON to the scheme index and the critical-validation requirements list.

No SDK/runtime implementation changes. The TypeScript (`@x402/tron`) and Python (`x402[tron]`) implementations will follow in separate PRs after this spec is approved.

### Why Permit2-only (vs. both paths)

The `eip3009` path on TRON is blocked on two external items:

1. **TIP-3009 does not exist.** `tronprotocol/tips` has no TIP for `transferWithAuthorization`. TIP-712 exists and is `Final`, which is what the Permit2 path depends on.
2. **No TRC-20 implements `transferWithAuthorization`.** Verified: USDT mainnet, USDT Nile, USDT Shasta, USDD.

Both are independent of x402. When they land, the `eip3009` path can be added in a follow-up PR without breaking anything in this spec.

Permit2-only covers every existing TRC-20 (including USDT and USDD) and uses byte-compatible EIP-712 semantics with Uniswap Permit2.

### Why TRON as an independent package

- Different address format: Base58 (`T...`) vs. `0x` hex
- Different chain SDK: TronWeb vs. viem / ethers
- Different CAIP-2 namespace: `tron:` vs. `eip155:`
- No ERC-1271, ERC-6492, or Multicall3 support
- Follows the existing pattern: all 5 mechanism packages (`evm`, `svm`, `avm`, `aptos`, `stellar`) are independent.

### Permit2 compatibility with Uniswap Permit2

SUN.io Permit2 ([source](https://github.com/sun-protocol/sunswap-permit2)) is a byte-identical fork of Uniswap Permit2 adapted to TIP-712:

- Same EIP-712 domain typehash and nameHash (`keccak256("Permit2")`, no version field)
- Same `PermitTransferFrom` / `PermitBatchTransferFrom` / `PermitSingle` / `PermitBatch` / `AllowanceTransferDetails` typehashes and struct layouts
- Same nonce bitmap (248-bit wordPos + 8-bit bitPos, via `_useUnorderedNonce`)
- `DOMAIN_SEPARATOR` uses `block.chainid` at full value (no truncation)

Mainnet deployment: `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` — source-verified on TronScan, ~27,588 transactions.

### TRON-specific constraints called out in the spec

- **No approval sponsoring.** TRC-20's `approve()` requires `msg.sender` to be the token owner, so a facilitator cannot sponsor the `approve()` call. The Permit2 fallback is two-layer: EIP-2612 `permit` → manual user `approve`.
- **ecrecover-only signature verification.** TRON has no ERC-1271, so contract-wallet signatures are not supported.
- **No Multicall3.** Diagnosis uses sequential `triggerConstantContract` calls.
- **TIP-712** (`Final`) is the formal TRON standard referenced for signing semantics.

### Tests

No code affected.

### Checklist

- [x] My commits are signed (required for merge)
- [x] Spec follows the structure of `scheme_exact_evm.md`
- [x] All error codes listed in the Appendix
- [x] All supported networks enumerated with CAIP-2 + chain ID

---

## Full content of `scheme_exact_tron.md`

````markdown
# Scheme: `exact` on TRON

## Summary

The `exact` scheme on TRON executes a transfer where the Facilitator pays the gas (energy + bandwidth), but the Client controls the exact flow of funds via TIP-712 signatures. TIP-712 ([tip-712.md](https://github.com/tronprotocol/tips/blob/master/tip-712.md), status `Final`) is TRON's implementation of EIP-712 and uses the identical signing format and domain separator structure.

This spec covers `assetTransferMethod: "permit2"` only.

| `assetTransferMethod` | Requires | On-chain call |
|---|---|---|
| `permit2` | Token is any TRC-20; user has Permit2 allowance (or first-time `permit`) | `Permit2.permitTransferFrom(permit, transferDetails, owner, signature)` |

The `eip3009` variant is **not supported on TRON in this spec version**. No TRC-20 currently implements `transferWithAuthorization`, and TIP-3009 has not been proposed. A follow-up spec PR will add the `eip3009` path once those land.

TRON does **not** support ERC-1271, ERC-6492, or Multicall3. Signature verification is `ecrecover`-only.

## Address Conventions

- `paymentRequirements` fields (`asset`, `payTo`) use TRON Base58 (`T...`).
- `payload.permit.permitted.token`, `payload.permit.spender`, `payload.transferDetails.to`, and the signing `owner` use EVM hex (`0x...`).
- Conversion: Base58Check → drop the prefix byte (`0x41`) → `0x` + the remaining 20 bytes hex.

## Phase 1: PAYMENT-SIGNATURE Header Payload

```json
{
  "x402Version": 2,
  "payload": {
    "signature": "0x...",
    "permit": {
      "permitted": { "token": "0x...", "amount": "100000" },
      "spender": "0x...",
      "nonce": "<bitmap nonce>",
      "deadline": "1713003600"
    },
    "transferDetails": {
      "to": "0x...",
      "requestedAmount": "100000"
    }
  },
  "accepted": {
    "scheme": "exact",
    "network": "tron:nile",
    "amount": "100000",
    "asset": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    "payTo": "TYukBQZ2XXCehNLMRhRx6A4XKXD7cT6bnX",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "name": "Permit2",
      "version": "1",
      "assetTransferMethod": "permit2",
      "permit2Address": "TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx"
    }
  }
}
```

The signature is a TIP-712 signature over the `PermitTransferFrom` struct, with domain `{ name: "Permit2", chainId: <full block.chainid>, verifyingContract: <Permit2 address, hex> }`. Typehashes are byte-identical to Uniswap Permit2 (`libraries/PermitHash.sol`).

## Phase 2: Verification Logic

1. `scheme == "exact"` and `network` starts with `tron:`.
2. `extra.name == "Permit2"` and `extra.version` present.
3. `extra.permit2Address` matches the expected Permit2 for `network` (see Appendix).
4. Base58→hex conversion applied to `requirements.payTo` before comparison against `transferDetails.to`.
5. `permit.permitted.token` (after Base58→hex conversion of `requirements.asset`) matches.
6. `transferDetails.requestedAmount` equals `requirements.amount` and equals `permit.permitted.amount`.
7. `deadline` > `now + 6s` (TRON block-time buffer, ~3s block interval).
8. Signer recovered via `ecrecover` from the TIP-712 signature (no ERC-1271 fallback) matches the expected owner.
9. Pre-flight check: facilitator SHOULD call `Permit2Helper.checkPermit2Allowance(owner, token, spender, amount)` if the Helper is deployed on `network` (see Appendix), OR call `Permit2.allowance(owner, token, spender)` directly. If the allowance is insufficient or expired, fall back:
   - Try token's EIP-2612 `permit` (if implemented) to set Permit2 as spender.
   - Otherwise require the user to send a manual `approve(permit2, max)` transaction. **The facilitator cannot sponsor this `approve()` — TRC-20's `approve()` requires `msg.sender` to be the token owner.**
10. Simulate the transfer via `triggerConstantContract` against the Permit2 `permitTransferFrom` entry point.
11. On simulation failure, diagnose sequentially (no Multicall3):
    - `Permit2.allowance(owner, token, spender)`
    - Token `balanceOf(owner)`
    - Token `allowance(owner, permit2)`

## Phase 3: Settlement Logic

1. Re-verify payload (including allowance / Helper pre-flight).
2. `triggerSmartContract` on Permit2:
   - selector: `permitTransferFrom((TokenPermissions,uint256,uint256),(address,uint256),address,bytes)`
   - `feeLimit`: 100 TRX (configurable).
3. Wait for confirmation via `getTransactionInfo(txid)` (~3s per block).

## Appendix: SUN.io Permit2 Deployments

| Network | Permit2 | Permit2Helper (optional) |
|---|---|---|
| Mainnet | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` (TronScan-verified, ~27,588 live txs) | `TBc4z7389sAtM2nZRgWwHSJnHrWeUrZ3rL` |
| Nile | `TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx` | `TJcVB8vQVpAoGwp9owx1Ct91D4QpKVd78h` |

Source code: https://github.com/sun-protocol/sunswap-permit2

Interface compatibility with Uniswap Permit2:

- EIP-712 domain typehash, nameHash, struct layouts, function signatures: byte-identical.
- `DOMAIN_SEPARATOR` uses `block.chainid` at full value (no truncation). See `contracts/EIP712.sol`.
- Nonce scheme: bitmap, 248-bit wordPos + 8-bit bitPos (same as Uniswap).

`Permit2Helper` is a SUN.io convenience contract with no EVM analogue. It exposes:

```solidity
function checkPermit2Allowance(
  address permit2,
  address token,
  address user,
  address spender,
  uint160 lastAmount
) external view returns (bool)
```

Returns `false` if any of:
- `lastAmount > currentAllowanceAmount`
- `block.timestamp > expiration`
- `expiration - block.timestamp ≤ 200` **seconds**

The 200-second buffer is SUN-specific. The x402 spec treats the Helper as optional — facilitators can equivalently call `Permit2.allowance()` directly.

## Appendix: Supported Tokens

Every TRC-20 is eligible via the Permit2 path, provided the user has a Permit2 allowance on that token (or signs an EIP-2612 `permit` if supported, or sends a manual `approve`).

Notable tokens:

| Token | Mainnet | Nile |
|---|---|---|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj` |
| USDD | `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` | — |

## Appendix: Chain IDs

| Network | CAIP-2 | Chain ID |
|---|---|---|
| Mainnet | `tron:mainnet` | `728126428` |
| Nile | `tron:nile` | `3448148188` |

Shasta is not included — it lags Nile on features and does not allow external nodes; Nile is the recommended TRON testnet.

## Appendix: Error Codes

- `invalid_exact_tron_scheme`
- `invalid_exact_tron_network_mismatch`
- `invalid_exact_tron_missing_eip712_domain`
- `invalid_exact_tron_permit2_address_mismatch`
- `invalid_exact_tron_recipient_mismatch`
- `invalid_exact_tron_signature`
- `invalid_exact_tron_deadline_expired`
- `invalid_exact_tron_authorization_value`
- `invalid_exact_tron_insufficient_balance`
- `invalid_exact_tron_permit2_allowance_insufficient`
- `invalid_exact_tron_permit2_allowance_expired`
- `invalid_exact_tron_permit2_not_deployed`
- `invalid_exact_tron_transaction_simulation_failed`
- `invalid_exact_tron_transaction_failed`
````

---

## Patch to `scheme_exact.md`

Add after the `### Stellar` section:

````markdown
### TRON

- Address conversion: Base58 addresses in `paymentRequirements` MUST be converted to EVM hex (`0x`) before signature verification and on-chain calls.
- Facilitator safety: the facilitator's address MUST NOT appear as `owner` in the Permit2 signature.
- Recipient correctness: `transferDetails.to` MUST match `payTo` after Base58→hex conversion.
- Amount exactness: `transferDetails.requestedAmount` and `permit.permitted.amount` MUST both equal `requirements.amount`.
- Signature verification: `ecrecover` only — TRON does not support ERC-1271 contract signatures.
- Approval sponsoring is **not** available — TRC-20's `approve()` requires `msg.sender` to be the token owner. The `permit2` path falls back two levels only: EIP-2612 `permit` → manual user `approve`.
- `assetTransferMethod: "permit2"` is the only supported method for TRON in this spec version. `eip3009` will be added once TIP-3009 exists and at least one TRC-20 implements `transferWithAuthorization`.

Network-specific rules are in per-network documents: ..., `scheme_exact_tron.md` (TRON).
````
