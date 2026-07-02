# exact_permit Scheme Specification

## Overview

The `exact_permit` scheme uses EIP-712 (EVM) / TIP-712 (TRON) typed-data signatures to authorize token transfers via a **PaymentPermit** smart contract. The buyer signs a structured permit; the facilitator calls the contract's `permitTransferFrom` to execute the transfer on-chain.

## Scheme Identifier

`"exact_permit"`

## EIP-712 Signing Specification

### Domain

```json
{
  "name": "PaymentPermit",
  "chainId": "<chain_id as uint256>",
  "verifyingContract": "<PaymentPermit contract address in EVM hex format>"
}
```

Domain type definition:
```
[
  { name: "name",              type: "string"  },
  { name: "chainId",           type: "uint256" },
  { name: "verifyingContract", type: "address" }
]
```

Note: TRON addresses must be converted to EVM hex format (0x-prefixed) for signing.

### Types

```
PermitMeta:
  kind              uint8       # KIND_MAP["PAYMENT_ONLY"] = 0
  paymentId         bytes16     # 16-byte payment ID
  nonce             uint256
  validAfter        uint256     # Unix seconds
  validBefore       uint256     # Unix seconds

Payment:
  payToken          address
  payAmount         uint256
  payTo             address

Fee:
  feeTo             address
  feeAmount         uint256

PaymentPermitDetails:            # << Primary Type
  meta              PermitMeta
  buyer             address
  caller            address
  payment           Payment
  fee               Fee
```

### Primary Type

`"PaymentPermitDetails"`

### Type Conversions for Signing

When converting the PaymentPermit data model to EIP-712 message values:

| Field | Source type | EIP-712 type | Conversion |
|-------|-----------|--------------|------------|
| `kind` | string `"PAYMENT_ONLY"` | uint8 | Lookup in KIND_MAP -> `0` |
| `paymentId` | hex string `"0x..."` | bytes16 | Hex decode to 16 bytes |
| `nonce` | string | uint256 | Parse as integer |
| `payAmount`, `feeAmount` | string | uint256 | Parse as integer |
| All addresses | Base58 (TRON) or hex (EVM) | address | Convert to 0x-prefixed EVM hex |

## Client Behavior

1. Receive `PaymentRequirements` with `scheme: "exact_permit"` and `PaymentPermitContext` from extensions
2. Build a `PaymentPermit` structure:
   - `buyer` = client's own address
   - `caller` = facilitator's caller address (from `extra.fee.caller`, or zero address)
   - `payment` = from requirements (payToken=asset, payAmount=amount, payTo=payTo)
   - `fee` = from requirements extra (feeTo, feeAmount)
   - `meta` = from PaymentPermitContext (kind, paymentId, nonce, validAfter, validBefore)
3. **Ensure token allowance**: the buyer must have approved the **PaymentPermit contract** to spend at least `payAmount + feeAmount` of the token. If insufficient, send an on-chain `approve` transaction first.
   - EVM: approve for `2^256 - 1` (max uint256)
   - TRON: approve for `2^160 - 1` (max uint160)
4. Convert permit to EIP-712 typed data message (apply type conversions above)
5. Sign with buyer's private key using `signTypedData(domain, types, message, "PaymentPermitDetails")`
6. Return `PaymentPayload` with the signature and permit

## Server Behavior

1. Receive `PaymentPayload` with `PAYMENT-SIGNATURE` header
2. Anti-tampering: verify that `payload.accepted` matches the original requirements issued by this server
3. Recover signer address from the EIP-712 signature
4. Verify recovered address matches `payload.payload.paymentPermit.buyer`
5. Delegate to facilitator for settlement

## Facilitator Behavior

### Validation Rules

Before settlement, the facilitator must validate the permit:

| Rule | Check |
|------|-------|
| Amount | `payment.payAmount >= required amount` |
| Token | `payment.payToken == required asset` (case-insensitive) |
| Recipient | `payment.payTo == required payTo` (case-insensitive) |
| Fee recipient | `fee.feeTo == facilitator's configured fee address` |
| Fee amount | `fee.feeAmount >= facilitator's configured base fee` |
| Time window | `meta.validAfter <= current_time <= meta.validBefore` |
| Token whitelist | If configured, `payment.payToken` must be in allowed set |

### Settlement

1. Verify the EIP-712 signature (recover signer, match against buyer)
2. Call the PaymentPermit contract: `permitTransferFrom(permit, owner, signature)`
3. Wait for the transaction receipt
4. Check transaction status for success
5. Return `SettleResponse` with transaction hash

## Address Handling

- **TRON networks**: All addresses in the EIP-712 message must be in EVM hex format (0x-prefixed). The system converts between TRON Base58 and EVM hex as needed.
- **EVM networks**: Addresses use standard checksummed hex format.
- Address comparisons for validation are case-insensitive.
