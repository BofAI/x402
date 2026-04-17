# TRON exact scheme — 提案文档

> **目的：** 直接拿去提交 GitHub Issue 和 Spec PR 的内容。
>
> 决策依据见 [TRON_CONTRIBUTION_ANALYSIS.md](TRON_CONTRIBUTION_ANALYSIS.md)，代码实施见 [TRON_CONTRIBUTION_IMPL.md](TRON_CONTRIBUTION_IMPL.md)。

---

## 1. GitHub Issue

**仓库：** `x402-foundation/x402`

**标题：** `[Proposal] Add TRON exact scheme — ERC-3009 via TIP-712`

**Labels:** `enhancement`, `new-chain`

**内容：**

```markdown
## Problem

TRON has 200M+ active accounts and is the largest USDT settlement network by volume.
Currently x402 has no TRON support, meaning agents and services on TRON cannot
participate in the x402 payment ecosystem.

## High-level approach

Add `exact` scheme support for TRON using ERC-3009 `transferWithAuthorization`,
signed via TIP-712 (TRON's implementation of EIP-712 — identical signing format).

- **Independent `@x402/tron` package** — TRON uses Base58 addresses, TronWeb SDK,
  and `tron:` CAIP-2 prefix, so it does not fit cleanly inside the EVM package.
- **3-PR workflow** per CONTRIBUTING.md:
  1. Spec: `specs/schemes/exact/scheme_exact_tron.md`
  2. TypeScript reference implementation (`@x402/tron`)
  3. Python implementation (`x402[tron]`)

## Why independent package (not inside @x402/evm)

Although TRON shares the ERC-3009 signing structure with EVM at the protocol layer,
the implementation layer is fundamentally incompatible:

- Different address format: Base58 (`T...`) vs `0x` hex
- Different chain SDK: TronWeb vs viem
- Different CAIP-2 namespace: `tron:` vs `eip155:`
- No ERC-1271/ERC-6492/Multicall3 support
- `FacilitatorEvmSigner` method signatures are fully incompatible (ABI-based vs selector-based)
- Follows existing pattern: all 5 mechanism packages (EVM/SVM/AVM/Aptos/Stellar) are independent

## Why existing schemes don't suffice

- EVM `exact` assumes `0x` addresses, viem/ethers signers, and EIP-155 chain IDs.
  TRON has Base58 addresses, TronWeb SDK, and non-EIP-155 chain IDs (728126428).
- The on-chain ERC-3009 interface is identical, but the signing/addressing layer differs.

## Token ecosystem status

> **Transparency note:** Current TRON mainnet USDT (`TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`)
> does not implement `transferWithAuthorization`. To address this:
>
> 1. **Permit2 path** — SUN.io's production Permit2 contract
>    ([open source](https://github.com/sun-protocol/sunswap-permit2),
>    based on Uniswap Permit2 + TIP-712) deployed on both mainnet
>    (`TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9`) and Nile testnet
>    (`TCJjTtzwRJYPapGTdyJdKcr7MqkngRRWQx`), covers **all existing TRC-20
>    tokens** including USDT, without requiring any token contract changes.
> 2. **EIP-3009 path** — Validated against self-deployed TIP-3009 test tokens on Nile testnet.
>    We are concurrently working on a TIP-3009 proposal to standardize
>    `transferWithAuthorization` for TRC-20 tokens in the TRON ecosystem.
>
> Both paths are included in this contribution, matching EVM's dual `assetTransferMethod` design.

## Working proof

- BofAI has shipped a production TRON x402 SDK (`bankofai-x402`) with `exact`,
  `exact_permit`, and `exact_gasfree` schemes.
- BSC testnet interop validated with Coinbase official client/server (2026-04-03).
- We propose contributing the `exact` scheme (with both `eip3009` and `permit2`
  asset transfer methods, matching EVM). The `exact_permit` and `exact_gasfree`
  schemes are vendor-specific and not included.

## Supported networks

| Network | CAIP-2 | Chain ID | Status |
|---------|--------|----------|--------|
| TRON Mainnet | `tron:mainnet` | 728126428 | Production |
| TRON Nile | `tron:nile` | 3448148188 | Testnet (recommended for dev) |
| TRON Shasta | `tron:shasta` | 2494104990 | Testnet |
```

---

## 2. Spec PR

**分支：** `feature/tron-exact-spec`

**PR 标题：** `specs(exact): add TRON exact scheme specification`

**PR 描述：**

```markdown
## Description

Adds formal specification for the `exact` payment scheme on TRON blockchain.
Closes #<issue_number>.

- Adds `specs/schemes/exact/scheme_exact_tron.md` — full spec for ERC-3009 via TIP-712
- Updates `specs/schemes/exact/scheme_exact.md` — adds TRON critical validation rules

No SDK/runtime implementation changes. Implementation PR follows after spec approval.

## Why TRON as independent package (not inside @x402/evm)

- Different address format: Base58 (`T...`) vs `0x` hex
- Different chain SDK: TronWeb vs viem
- Different CAIP-2 namespace: `tron:` vs `eip155:`
- No ERC-1271/ERC-6492/Multicall3 support
- Follows existing pattern: all 5 mechanism packages are independent

## Tests

No code affected.

## Checklist

- [x] My commits are signed (required for merge)
```

### 2.1 新增文件：`specs/schemes/exact/scheme_exact_tron.md`

参照 `scheme_exact_evm.md` 结构。

```markdown
# Scheme: `exact` on TRON

## Summary

The `exact` scheme on TRON executes a transfer where the Facilitator pays the
gas (energy/bandwidth), but the Client controls the exact flow of funds via
TIP-712 signatures (TRON's implementation of EIP-712).

Two asset transfer methods are supported, matching EVM's dual-path design:

| AssetTransferMethod | Description |
|---------------------|-------------|
| **eip3009** | `transferWithAuthorization` — same on-chain interface as EVM EIP-3009. Requires token to implement TIP-3009. |
| **permit2** | Permit2 contract proxy — covers **all standard TRC-20 tokens** (including USDT). Uses SUN.io's production Permit2 contract (`TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9`) adapted for TIP-712. |

TRON does not support ERC-1271 or ERC-6492 (no contract wallets).

## Address Conventions

- `paymentRequirements` fields (`asset`, `payTo`) use TRON Base58 (`T...`)
- `payload.authorization` fields (`from`, `to`) use EVM hex (`0x...`)
- Conversion: Base58Check → drop prefix byte (0x41) → `0x` + 20 bytes hex

## Phase 1: PAYMENT-SIGNATURE Header Payload

### EIP-3009 path (`assetTransferMethod: "eip3009"`)

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
    "asset": "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",
    "payTo": "TYukBQZ2XXCehNLMRhRx6A4XKXD7cT6bnX",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "name": "Tether USD",
      "version": "1",
      "assetTransferMethod": "eip3009"
    }
  }
}
```

### Permit2 path (`assetTransferMethod: "permit2"`)

```json
{
  "x402Version": 2,
  "payload": {
    "signature": "0x...",
    "permit": {
      "permitted": {
        "token": "0x...",
        "amount": "100000"
      },
      "nonce": "123456",
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
    "asset": "TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj",
    "payTo": "TYukBQZ2XXCehNLMRhRx6A4XKXD7cT6bnX",
    "maxTimeoutSeconds": 3600,
    "extra": {
      "assetTransferMethod": "permit2",
      "permit2Address": "T...",
      "facilitator": "T..."
    }
  }
}
```

> **Note:** Permit2 path 的 `extra` 不需要 `name`/`version`（EIP-712 domain 用 Permit2 合约自身的，不用 token 的）。
> `facilitator` 是 Permit2 签名中的 `spender`（调用 `permitTransferFrom` 的地址）。

## Phase 2: Verification Logic

Route by `extra.assetTransferMethod` (default: `"eip3009"`).

### Common checks (both paths)

1. Verify `scheme == "exact"` and `network` starts with `"tron:"`
2. Verify facilitator address NOT in `from`

### EIP-3009 verification

3. Verify `extra.name` and `extra.version` are present (EIP-712 domain)
4. Recover signer via `ecrecover` from TIP-712 signature → must match `authorization.from`
5. Verify `authorization.to == payTo` (after Base58 → hex conversion)
6. Verify `authorization.value == requirements.amount`
7. Verify `validBefore > now + 6s` (block time buffer)
8. Verify `validAfter <= now`
9. Simulate: `triggerConstantContract("transferWithAuthorization", ...)`
10. If simulation fails, diagnose:
    a. `balanceOf(from) >= value`
    b. `authorizationState(from, nonce) == false`
    c. Token supports ERC-3009

### Permit2 verification

3. Verify `extra.permit2Address` is present
4. Recover signer via `ecrecover` from Permit2 TIP-712 signature
5. Verify `transferDetails.to == payTo` (after Base58 → hex conversion)
6. Verify `permit.permitted.amount == requirements.amount`
7. Verify `permit.deadline > now`
8. Check token allowance to Permit2 contract: `token.allowance(owner, permit2Address) >= amount`
   (this is standard ERC-20 approve, not Permit2 internal state)
9. If token allowance insufficient, check for EIP-2612 permit extension in payload
   (Note: unlike EVM, TRON does not support approval sponsoring — `approve()` requires `msg.sender` to be the token owner)

## Phase 3: Settlement Logic

Route by `extra.assetTransferMethod`.

### EIP-3009 settlement

1. Re-verify payload
2. Call `triggerSmartContract` on token contract:
   - function: `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`
   - feeLimit: 100 TRX (configurable)
3. Wait for confirmation: `getTransactionInfo(txid)`, ~3s block time

### Permit2 settlement

1. Re-verify payload
2. If EIP-2612 permit extension present: execute `permit()` on token first
3. Call `triggerSmartContract` on Permit2 contract:
   - function: `permitTransferFrom(permit, transferDetails, owner, signature)`
   - feeLimit: 100 TRX (configurable)
4. Wait for confirmation: `getTransactionInfo(txid)`, ~3s block time

## Critical Validation Requirements

- **Address conversion**: Base58 addresses in `paymentRequirements` MUST be converted
  to EVM hex (`0x`) for signature verification and on-chain calls.
- **Facilitator safety**: the facilitator's address MUST NOT appear as `from`
  in the authorization (eip3009) or as `owner` (permit2).
- **Recipient correctness**: `authorization.to` (eip3009) or `transferDetails.to` (permit2)
  MUST match `payTo` after Base58 → hex conversion.
- **Amount exactness**: `authorization.value` (eip3009) or `permit.permitted.amount` (permit2)
  MUST equal `requirements.amount`.
- **Signature verification**: `ecrecover` only — TRON does not support ERC-1271
  contract signatures.
- **Permit2 token approval**: For `permit2` path, the token owner must have approved
  the Permit2 contract via standard ERC-20 `approve(permit2Address, amount)`.
  If not, an EIP-2612 permit extension must be included (if token supports `permit()`).
  Note: unlike EVM, TRON does not support approval sponsoring — `approve()` requires
  `msg.sender` to be the token owner, so facilitator cannot sponsor approvals.

## Appendix: Supported Tokens

| Token | Mainnet | Nile | Shasta |
|-------|---------|------|--------|
| USDT | TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t | TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj | TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs |
| USDD | TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn | — | — |

## Appendix: Chain IDs

| Network | CAIP-2 | Chain ID |
|---------|--------|----------|
| Mainnet | tron:mainnet | 728126428 |
| Nile | tron:nile | 3448148188 |
| Shasta | tron:shasta | 2494104990 |

## Appendix: Error Codes

### Common
- `invalid_exact_tron_scheme`
- `invalid_exact_tron_network_mismatch`
- `invalid_exact_tron_recipient_mismatch`
- `invalid_exact_tron_signature`
- `invalid_exact_tron_authorization_value`
- `invalid_exact_tron_insufficient_balance`
- `invalid_exact_tron_transaction_simulation_failed`
- `invalid_exact_tron_transaction_failed`

### EIP-3009 specific
- `invalid_exact_tron_missing_eip712_domain`
- `invalid_exact_tron_payload_authorization_valid_before`
- `invalid_exact_tron_payload_authorization_valid_after`
- `invalid_exact_tron_nonce_already_used`
- `invalid_exact_tron_eip3009_not_supported`

### Permit2 specific
- `invalid_exact_tron_permit2_address_missing`
- `invalid_exact_tron_permit2_deadline_expired`
- `invalid_exact_tron_permit2_allowance_insufficient`
- `invalid_exact_tron_permit2_signature_invalid`

## Future Considerations

> A TIP-3009 proposal is being prepared concurrently to standardize
> `transferWithAuthorization` for TRC-20 tokens in the TRON ecosystem.
> As more tokens adopt TIP-3009, the `eip3009` path will become the primary
> method, with `permit2` serving as the universal fallback for legacy TRC-20 tokens.
```

### 2.2 修改文件：`specs/schemes/exact/scheme_exact.md`

在 `### Stellar` 后加：

```markdown
### TRON

- Address conversion: Base58 addresses in paymentRequirements MUST be converted to EVM hex (`0x`) for signature verification and on-chain calls.
- Facilitator safety: the facilitator's address MUST NOT appear as `from`/`owner` in the authorization.
- Recipient correctness: `authorization.to` (eip3009) or `transferDetails.to` (permit2) MUST match `payTo` after Base58→hex conversion.
- Amount exactness: `authorization.value` (eip3009) or `permit.permitted.amount` (permit2) MUST equal `requirements.amount`.
- Signature verification: ecrecover only — TRON does not support ERC-1271 contract signatures.
- Dual path: supports both `eip3009` (TIP-3009 tokens) and `permit2` (all standard TRC-20 via self-deployed Permit2 contract).

Network-specific rules are in per-network documents: ..., `scheme_exact_tron.md` (TRON).
```
