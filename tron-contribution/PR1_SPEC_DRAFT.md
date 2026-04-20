# PR1 Draft — TRON exact scheme specification (Permit2 + ERC-3009)

> **Target repo:** `x402-foundation/x402`
> **Branch:** `feature/tron-exact-spec` (to be created from upstream `main`)
> **PR title:** `specs(exact): add TRON exact scheme specification`
> **Depends on:** Issue #<issue_number> (will be filled in after Issue is opened)
> **Related:** PR #1408 — alternative approach using pre-signed TRON transactions (this spec uses TIP-712 signed authorizations instead)

This PR adds the specification only — dual-path (`permit2` + `eip3009`), matching the EVM `exact` scheme structure. No SDK/runtime code in this PR. Implementation PRs (PR2 TypeScript, PR3 Python) follow after spec review.

---

## Files changed in this PR

| File | Status | Purpose |
|---|---|---|
| `specs/schemes/exact/scheme_exact_tron.md` | **new** | Full TRON `exact` spec covering both `assetTransferMethod: "permit2"` and `"eip3009"` |
| `specs/schemes/exact/scheme_exact.md` | modified | Append TRON section to the scheme index and critical-validation checklist |

No code, examples, or tests are changed.

---

## PR body (copy-paste ready)

### Description

Adds formal specification for the `exact` payment scheme on TRON, covering both `assetTransferMethod` variants defined by the EVM spec: `permit2` and `eip3009`.

Closes #<issue_number>.

- Adds `specs/schemes/exact/scheme_exact_tron.md` — full TRON `exact` spec (both paths).
- Updates `specs/schemes/exact/scheme_exact.md` — appends TRON to the scheme index and the critical-validation requirements list.

No SDK/runtime implementation changes. The TypeScript (`@x402/tron`) and Python (`x402[tron]`) implementations will follow in separate PRs after this spec is approved.

### Alternative to PR #1408

PR #1408 proposes a different approach (client signs a complete TRON `TriggerSmartContract` transaction, facilitator broadcasts). The most material difference between the two approaches is the **energy payer**: in #1408, the client pays TRON energy (TRON debits the signed tx's `owner_address`); in this spec, the facilitator pays (the facilitator is the `owner_address` of the on-chain tx, while the user only signs TIP-712 structured data). This mirrors x402's EVM gasless-client property.

This Issue+PR is filed in parallel, not as a replacement. Happy to unify if @EruditeIntelligence wants to collaborate on a single spec.

### Why TRON as an independent package

- Different address format: Base58 (`T...`) vs. `0x` hex
- Different chain SDK: TronWeb vs. viem / ethers
- Different CAIP-2 namespace: `tron:` vs. `eip155:`
- No ERC-1271, ERC-6492, or Multicall3 support
- Follows the existing pattern: all 5 mechanism packages (`evm`, `svm`, `avm`, `aptos`, `stellar`) are independent.

### Dual `assetTransferMethod`

This spec defines both paths already established by the EVM `exact` scheme:

1. **`permit2`** — uses SUN.io's production Permit2 ([source](https://github.com/sun-protocol/sunswap-permit2)), byte-identical to Uniswap Permit2 adapted to TIP-712. Covers every TRC-20 (USDT, USDD, etc.). Mainnet deployment `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` is TronScan-verified with ~27,588 live txs.
2. **`eip3009`** — `transferWithAuthorization` signed via TIP-712. Requires the token to implement the ERC-3009 interface. BofAI will deploy an ERC-3009-compatible TRC-20 on Nile (and optionally mainnet) before PR2 opens, and add the address + source-verification link to the "Supported Tokens" appendix.

### Why no TIP-3009 dependency

`tronprotocol/tips` does not currently contain a TIP-3009 document. This spec follows the USDC precedent — USDC shipped `transferWithAuthorization` on Ethereum before EIP-3009 reached `Final` status. The on-chain interface is well-established via EIP-3009 and the signing layer uses TIP-712 (`Final`). A formal TIP-3009 can be proposed to `tronprotocol/tips` in a separate thread without blocking this x402 work.

### Permit2 compatibility with Uniswap Permit2

SUN.io Permit2 is a byte-identical fork of Uniswap Permit2:

- Same EIP-712 domain typehash and nameHash (`keccak256("Permit2")`, no version field)
- Same `PermitTransferFrom` / `PermitBatchTransferFrom` / `PermitSingle` / `PermitBatch` / `AllowanceTransferDetails` typehashes and struct layouts
- Same nonce bitmap (248-bit wordPos + 8-bit bitPos, via `_useUnorderedNonce`)
- `DOMAIN_SEPARATOR` uses `block.chainid` at full value (no truncation)

No contract modifications are required. An x402 `exact.permit2` payload produces identical EIP-712 digests on EVM and TRON modulo `chainId` + `verifyingContract`.

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
- [x] Both `assetTransferMethod` values documented with payload examples

---

## Full content of `scheme_exact_tron.md`

````markdown
# Scheme: `exact` on TRON

## Summary

The `exact` scheme on TRON executes a transfer where the Facilitator pays the gas (energy + bandwidth), but the Client controls the exact flow of funds via TIP-712 signatures. TIP-712 ([tip-712.md](https://github.com/tronprotocol/tips/blob/master/tip-712.md), status `Final`) is TRON's implementation of EIP-712 and uses the identical signing format and domain separator structure.

Two asset-transfer methods are supported, selected by `paymentRequirements.extra.assetTransferMethod`:

| `assetTransferMethod` | Requires | On-chain call |
|---|---|---|
| `eip3009` | Token implements `transferWithAuthorization` | `<token>.transferWithAuthorization(from,to,value,validAfter,validBefore,nonce,v,r,s)` |
| `permit2` | Token is any TRC-20; user has Permit2 allowance (or first-time `permit` / `approve`) | `Permit2.permitTransferFrom(permit, transferDetails, owner, signature)` |

TRON does **not** support ERC-1271, ERC-6492, or Multicall3. Signature verification is `ecrecover`-only.

TRON does **not** have a formal TIP-3009 standard in `tronprotocol/tips` today. This spec references EIP-3009 directly for the on-chain `transferWithAuthorization` interface, following the USDC precedent of shipping the interface ahead of a formal standard document. TIP-712 (the signing layer) is `Final`.

## Address Conventions

- `paymentRequirements` fields (`asset`, `payTo`) use TRON Base58 (`T...`).
- `payload.authorization` / `payload.permit` / `payload.transferDetails` addresses use EVM hex (`0x...`).
- Conversion: Base58Check → drop the prefix byte (`0x41`) → `0x` + the remaining 20 bytes hex.

## Phase 1: PAYMENT-SIGNATURE Header Payload

### `eip3009`

```json
{
  "x402Version": 2,
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x...",
      "to": "0x...",
      "value": "100000",
      "validAfter": "1713000000",
      "validBefore": "1713003600",
      "nonce": "0x..."
    }
  },
  "accepted": {
    "scheme": "exact",
    "network": "tron:nile",
    "amount": "100000",
    "asset": "T...<BofAI x402 test USD on Nile>",
    "payTo": "TYukBQZ2XXCehNLMRhRx6A4XKXD7cT6bnX",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "name": "x402 Test USD",
      "version": "1",
      "assetTransferMethod": "eip3009"
    }
  }
}
```

Signature is a TIP-712 signature over the `TransferWithAuthorization` struct with domain `{ name, version, chainId: <block.chainid>, verifyingContract: <token address, hex> }`.

### `permit2`

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

Signature is a TIP-712 signature over `PermitTransferFrom` with domain `{ name: "Permit2", chainId: <block.chainid>, verifyingContract: <Permit2 address, hex> }`. Typehashes byte-identical to Uniswap Permit2 (`libraries/PermitHash.sol`).

## Phase 2: Verification Logic

### Common to both methods

1. `scheme == "exact"` and `network` starts with `tron:`.
2. `extra.name` and `extra.version` present.
3. Base58→hex conversion applied to `requirements.payTo` before comparison.
4. Amount exactness: `value` (or `requestedAmount`) equals `requirements.amount`.
5. Time: `validBefore` / `deadline` > `now + 6s` (TRON block-time buffer, ~3s block interval); `validAfter` ≤ `now` (eip3009 only).
6. Signer recovered via `ecrecover` (no ERC-1271 fallback) matches the expected owner.
7. Simulate the transfer via `triggerConstantContract`.

### `eip3009`-specific

8. On simulation failure, diagnose sequentially (no Multicall3):
   - `balanceOf(from) ≥ value`
   - `authorizationState(from, nonce) == false`
   - Token exposes the ERC-3009 ABI

### `permit2`-specific

8. `extra.permit2Address` matches the expected Permit2 address for `network` (see Appendix).
9. Pre-flight allowance check: facilitator SHOULD call `Permit2Helper.checkPermit2Allowance(permit2, token, owner, spender, amount)` if Helper is deployed, OR call `Permit2.allowance(owner, token, spender)` directly.
10. If allowance is insufficient or expired, fall back:
    - Try token's EIP-2612 `permit` (if implemented) to set Permit2 as spender.
    - Otherwise require the user to send a manual `approve(permit2, max)` transaction. **The facilitator cannot sponsor this `approve()` — TRC-20's `approve()` requires `msg.sender` to be the token owner.**
11. On simulation failure, diagnose sequentially:
    - `Permit2.allowance(owner, token, spender)`
    - Token `balanceOf(owner)`
    - Token `allowance(owner, permit2)`

## Phase 3: Settlement Logic

### `eip3009`

1. Re-verify payload.
2. `triggerSmartContract` on the token:
   - selector: `transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)`
   - `feeLimit`: 100 TRX (configurable).
3. Wait for confirmation via `getTransactionInfo(txid)` (~3s per block).

### `permit2`

1. Re-verify payload (including allowance / Helper pre-flight).
2. `triggerSmartContract` on Permit2:
   - selector: `permitTransferFrom((TokenPermissions,uint256,uint256),(address,uint256),address,bytes)`
   - `feeLimit`: 100 TRX (configurable).
3. Wait for confirmation via `getTransactionInfo(txid)`.

In both cases the facilitator is the `owner_address` of the on-chain tx, so the facilitator's TRON account pays the energy/bandwidth. The user never needs to hold TRX.

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

### `permit2` path

Every TRC-20 is eligible via the Permit2 path, provided the user has a Permit2 allowance on that token (or signs an EIP-2612 `permit` if supported, or sends a manual `approve`).

Notable tokens:

| Token | Mainnet | Nile |
|---|---|---|
| USDT | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | `TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj` |
| USDD | `TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn` | — |

### `eip3009` path

Only tokens that implement the ERC-3009 interface (`transferWithAuthorization`, `authorizationState`, `DOMAIN_SEPARATOR`, `name`, `version`) qualify.

| Token | Mainnet | Nile |
|---|---|---|
| x402 Test USD (BofAI reference) | `<to be added before PR1 merge>` | `<to be added before PR1 merge>` |

BofAI will deploy and TronScan-verify the reference ERC-3009-compatible TRC-20 on Nile before PR1 merges and open up the source for any TRON project wanting to integrate natively without the Permit2 round-trip.

## Appendix: Chain IDs

| Network | CAIP-2 | Chain ID |
|---|---|---|
| Mainnet | `tron:mainnet` | `728126428` |
| Nile | `tron:nile` | `3448148188` |

Shasta is not included — it lags Nile on features and does not allow external nodes; Nile is the recommended TRON testnet.

## Appendix: Error Codes

### Shared

- `invalid_exact_tron_scheme`
- `invalid_exact_tron_network_mismatch`
- `invalid_exact_tron_missing_eip712_domain`
- `invalid_exact_tron_recipient_mismatch`
- `invalid_exact_tron_signature`
- `invalid_exact_tron_authorization_value`
- `invalid_exact_tron_insufficient_balance`
- `invalid_exact_tron_transaction_simulation_failed`
- `invalid_exact_tron_transaction_failed`

### `eip3009`-specific

- `invalid_exact_tron_payload_authorization_valid_before`
- `invalid_exact_tron_payload_authorization_valid_after`
- `invalid_exact_tron_nonce_already_used`
- `invalid_exact_tron_eip3009_not_supported`

### `permit2`-specific

- `invalid_exact_tron_permit2_address_mismatch`
- `invalid_exact_tron_deadline_expired`
- `invalid_exact_tron_permit2_allowance_insufficient`
- `invalid_exact_tron_permit2_allowance_expired`
- `invalid_exact_tron_permit2_not_deployed`
````

---

## Patch to `scheme_exact.md`

Add after the `### Stellar` section:

````markdown
### TRON

- Address conversion: Base58 addresses in `paymentRequirements` MUST be converted to EVM hex (`0x`) before signature verification and on-chain calls.
- Facilitator safety: the facilitator's address MUST NOT appear as `from` (eip3009) or `owner` (permit2) in the signed authorization.
- Recipient correctness: `authorization.to` (eip3009) or `transferDetails.to` (permit2) MUST match `payTo` after Base58→hex conversion.
- Amount exactness: `authorization.value` / `transferDetails.requestedAmount` MUST equal `requirements.amount`.
- Signature verification: `ecrecover` only — TRON does not support ERC-1271 contract signatures.
- Approval sponsoring is **not** available — TRC-20's `approve()` requires `msg.sender` to be the token owner. The `permit2` path falls back two levels only: EIP-2612 `permit` → manual user `approve`.
- The `eip3009` path uses the same on-chain interface as EIP-3009; TIP-712 (`Final`) is the signing standard. No formal TIP-3009 is required.

Network-specific rules are in per-network documents: ..., `scheme_exact_tron.md` (TRON).
````
