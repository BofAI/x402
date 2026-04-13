# exact_gasfree (TRON GasFree) Scheme Specification

## Overview

The `exact_gasfree` scheme enables gasless payments on TRON. Users hold tokens in a **GasFree custodial wallet** and sign TIP-712 permits. A **service provider** (relayer) submits the transaction on-chain, paying the gas fees and collecting a maxFee. This scheme is **TRON-only**.

## Scheme Identifier

`"exact_gasfree"`

## TIP-712 Signing Specification

### Domain

```json
{
  "name": "GasFreeController",
  "version": "V1.0.0",
  "chainId": "<TRON chain_id as uint256>",
  "verifyingContract": "<GasFreeController contract address in EVM hex format>"
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

### Types

```
PermitTransfer:                  # << Primary Type
  token             address     # Token contract address
  serviceProvider   address     # Relayer / service provider address
  user              address     # Buyer's address
  receiver          address     # Payment recipient
  value             uint256     # Payment amount
  maxFee            uint256     # Maximum fee the relayer can deduct
  deadline          uint256     # Unix seconds expiry
  version           uint256     # Always 1
  nonce             uint256     # From GasFree API (incrementing)
```

### Primary Type

`"PermitTransfer"`

## GasFree Custodial Model

Each user has a **gasFreeAddress** — a custodial wallet managed by the GasFree contract. The user's tokens are held in this address. Transfers deduct from the gasFreeAddress balance, not the user's main wallet.

- The gasFreeAddress is derived deterministically from the user's main address
- The account must be **activated** before use (first transaction triggers activation)
- Balance check: `gasFreeAddress balance >= payment amount + maxFee`

## GasFree API Contract

All endpoints are served through the BankOfAI proxy:
- Mainnet: `https://facilitator.bankofai.io/mainnet`
- Shasta: `https://facilitator.bankofai.io/shasta`
- Nile: `https://facilitator.bankofai.io/nile`

All responses share a common envelope:
```json
{
  "code": 200,
  "reason": null,
  "message": null,
  "data": { ... }
}
```

### GET /api/v1/address/{user}

Returns account info for a user address.

**Response `data`**:
```json
{
  "accountAddress": "user's main address",
  "gasFreeAddress": "custodial wallet address",
  "active": true,
  "nonce": 5,
  "allowSubmit": true,
  "assets": [
    {
      "tokenAddress": "token contract address",
      "tokenSymbol": "USDT",
      "activateFee": 5000000,
      "transferFee": 3000000,
      "decimal": 6,
      "frozen": 0,
      "balance": "100000000"
    }
  ]
}
```

### GET /api/v1/config/provider/all

Returns list of supported service providers (relayers).

**Response `data`**:
```json
{
  "providers": [
    {
      "address": "provider address",
      "name": "Provider Name",
      "icon": "url",
      "website": "url",
      "config": {
        "maxPendingTransfer": 10,
        "minDeadlineDuration": 50,
        "maxDeadlineDuration": 600,
        "defaultDeadlineDuration": 300
      }
    }
  ]
}
```

### POST /api/v1/gasfree/submit

Submit a signed GasFree transaction.

**Request body**:
```json
{
  "token": "EVM hex address",
  "serviceProvider": "EVM hex address",
  "user": "EVM hex address",
  "receiver": "EVM hex address",
  "value": "string (uint256)",
  "maxFee": "string (uint256)",
  "deadline": 1234567890,
  "version": 1,
  "nonce": 5,
  "sig": "hex signature WITHOUT 0x prefix",
  "requestId": "x402-{unix_timestamp_ms}-{first_8_chars_of_sig}"
}
```

**Response `data`**: returns a `GasFreeSubmitResponseData` with an `id` (trace ID) for polling.

### GET /api/v1/gasfree/{traceId}

Poll transaction status.

**Response `data`**:
```json
{
  "id": "trace-id",
  "state": "WAITING | INPROGRESS | CONFIRMING | SUCCEED | FAILED",
  "txnHash": "on-chain tx hash (when available)",
  "txnState": "INIT | NOT_ON_CHAIN | ON_CHAIN | SOLIDITY | ON_CHAIN_FAILED",
  "reason": "error message (on failure)",
  "accountAddress": "...",
  "gasFreeAddress": "...",
  "providerAddress": "...",
  "targetAddress": "...",
  "nonce": 5,
  "tokenAddress": "...",
  "amount": "...",
  "createdAt": "ISO timestamp",
  "expiredAt": "ISO timestamp"
}
```

### Status State Machine

```
WAITING -> INPROGRESS -> CONFIRMING -> SUCCEED
                                    -> FAILED

txnState: INIT -> NOT_ON_CHAIN -> ON_CHAIN -> SOLIDITY
                               -> ON_CHAIN_FAILED
```

**Terminal success conditions**:
- `state == "SUCCEED"`, OR
- `txnHash` exists AND `txnState` is `"ON_CHAIN"` or `"SOLIDITY"`

**Terminal failure conditions**:
- `state == "FAILED"`, OR
- `txnState == "ON_CHAIN_FAILED"`

## Business Rules

### Deadline Bounds

The signed `deadline` must be clamped to network-specific bounds:

| Network | Min (seconds from now) | Max (seconds from now) |
|---------|----------------------|----------------------|
| tron:mainnet | 55 | 595 |
| tron:shasta, tron:nile | 55 | 3595 |

If the requested validity window exceeds the max, it is clamped. If below the min, it is rejected.

### Fee Calculation

`maxFee` in the signed message is calculated as:

```
maxFee = max(transferFee, facilitatorFee)
if account is NOT active AND activateFee > 0:
    maxFee += activateFee
if maxFee == 0:
    maxFee = 1 token unit (10^decimals)
```

Where:
- `transferFee`: per-token fee from the GasFree API account info (`assets[].transferFee`)
- `facilitatorFee`: from `PaymentRequirements.extra.fee.feeAmount`
- `activateFee`: one-time fee for account activation (`assets[].activateFee`)

### Balance Requirement

```
gasFreeAddress token balance >= payment amount + maxFee
```

If insufficient, reject with an `InsufficientGasFreeBalance` error.

### Account Eligibility

The user's GasFree account must satisfy: `active == true` OR `allowSubmit == true`.

### Service Provider Selection

- If the facilitator provides a `fee.feeTo` in the requirements, use that as the service provider
- Otherwise, fetch providers from the API and select one (random choice)

## Client Behavior

1. Fetch account info from GasFree API
2. Verify account eligibility (active or allowSubmit)
3. Determine service provider
4. Calculate maxFee (see formula above)
5. Verify gasFreeAddress has sufficient balance
6. Clamp deadline to network bounds
7. Sign TIP-712 PermitTransfer message
8. Build PaymentPayload with `gasfreeAddress` in extensions

## Facilitator Behavior

1. Verify the TIP-712 signature
2. Validate the service provider is in the allowed provider list
3. Check gasFreeAddress balance on-chain
4. Submit to GasFree API via POST /api/v1/gasfree/submit
5. Poll for success via GET /api/v1/gasfree/{traceId}
6. Return SettleResponse with the actual on-chain transaction hash

### Field Mapping (PaymentPermit -> PermitTransfer message)

| PaymentPermit field | PermitTransfer field |
|--------------------|--------------------|
| `payment.payToken` | `token` |
| `fee.feeTo` (caller) | `serviceProvider` |
| `buyer` | `user` |
| `payment.payTo` | `receiver` |
| `payment.payAmount` | `value` |
| `fee.feeAmount` | `maxFee` |
| `meta.validBefore` | `deadline` |
