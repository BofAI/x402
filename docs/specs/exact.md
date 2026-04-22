# exact (ERC-3009) Scheme Specification

## Overview

The `exact` scheme uses ERC-3009 `TransferWithAuthorization` — a single-use, pre-signed token transfer. The buyer signs an authorization directly against the **token contract** (not a separate permit contract). The facilitator calls `transferWithAuthorization` on the token contract to execute the transfer.

## Scheme Identifier

`"exact"`

## EIP-712 Signing Specification

### Domain

```json
{
  "name": "<token name from registry>",
  "version": "<token version from registry, default '1'>",
  "chainId": "<chain_id as uint256>",
  "verifyingContract": "<token contract address in EVM hex format>"
}
```

Domain type definition:
```
[
  { name: "name",              type: "string"  },
  { name: "version",           type: "string"  },
  { name: "chainId",           type: "uint256" },
  { name: "verifyingContract", type: "address" }
]
```

Note: Unlike `exact_permit`, the domain uses the **token contract** as verifyingContract, with the token's own name and version. These values come from the `PaymentRequirements.extra.name` and `extra.version` fields, or from the token registry.

### Types

```
TransferWithAuthorization:       # << Primary Type
  from              address
  to                address
  value             uint256
  validAfter        uint256     # Unix seconds
  validBefore       uint256     # Unix seconds
  nonce             bytes32     # Random 32-byte value
```

### Primary Type

`"TransferWithAuthorization"`

## Key Differences from exact_permit

| Aspect | exact_permit | exact |
|--------|-------------|-------|
| Domain verifyingContract | PaymentPermit contract | Token contract |
| Domain name | `"PaymentPermit"` | Token name (e.g., `"Tether USD"`) |
| Domain version | (none) | Token version (e.g., `"1"`) |
| Fee support | Yes (separate Fee struct) | No (feeAmount always `"0"`) |
| Allowance required | Yes (must approve PaymentPermit contract) | No (single-use authorization) |
| Nonce | From PaymentPermitContext (incrementing) | Random 32-byte hex value |
| Validity window | From PaymentPermitContext | Default 1 hour (3600 seconds) |
| Settlement call | `permitTransferFrom(permit, owner, sig)` | `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)` |

## Client Behavior

1. Receive `PaymentRequirements` with `scheme: "exact"`
2. Look up token metadata (name, version) from token registry or `extra` fields
3. Generate a random 32-byte nonce (as hex string)
4. Set validity window: `validAfter = now`, `validBefore = now + 3600`
5. Build EIP-712 domain using the token contract address
6. Sign the `TransferWithAuthorization` message with buyer's key
7. Return `PaymentPayload` with the signature

## Facilitator Behavior

### Fee Quoting

The `exact` scheme does **not** support fees. `feeAmount` is always `"0"`.

### Settlement

1. Extract the `TransferWithAuthorization` parameters from the payload
2. Decompose the signature into `v`, `r`, `s` components
3. Call the token contract: `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`
4. Wait for the transaction receipt and verify success
5. Return `SettleResponse` with transaction hash

### Server Verification

The `exact` scheme delegates all verification to the facilitator. Server-side signature verification returns `true` (passthrough) — the on-chain call itself serves as verification.
