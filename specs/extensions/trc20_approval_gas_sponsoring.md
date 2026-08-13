# Extension: `trc20ApprovalGasSponsoring`

> **Status:** Draft
>
> **Target:** BANK OF AI TypeScript SDK 1.1.0
>
> **Extension version:** `1`

## Summary

`trc20ApprovalGasSponsoring` enables the first `exact + Permit2` payment from an activated TRON
externally owned account (EOA) that has no TRX and no existing TRC-20 allowance to Permit2. The
client constructs and signs, but does not broadcast, a transaction calling
`token.approve(canonicalPermit2, MaxUint256)`. The facilitator strictly validates that transaction,
temporarily delegates the required Energy and, when needed, Bandwidth to the payer, broadcasts the
unchanged approval, settles the Permit2 payment, and reclaims the delegated resource share.

The extension follows the normal x402 extension flow and does not add a `prepare` endpoint:

```text
PaymentRequired declares extension
  -> Client constructs and signs approval
  -> PaymentPayload carries signed approval
  -> Resource Server uses the existing /verify and /settle APIs
  -> Facilitator validates, delegates, broadcasts, settles, and reclaims
```

Version `1` is limited to:

- the [`exact` TRON binding](../schemes/exact/scheme_exact_tron.md) with
  `extra.assetTransferMethod = "permit2"`;
- activated, single-signature EOAs using the default owner permission;
- an allowance of exactly zero;
- `approve(canonicalPermit2, MaxUint256)`; and
- temporary Stake 2.0 delegation with `lock = false`.

Version `1` does not define a new scheme, a general resource-rental API, reset-to-zero handling,
smart-contract or multisignature payers, a user Sponsor Fee or collateral transfer, GasFree-account
settlement, or an external Energy-provider protocol. A non-zero but insufficient allowance fails
with `approval_reset_required`.

TRON resource delegation is account-scoped, not transaction-scoped. The extension cannot
cryptographically reserve delegated resources for the Approval transaction. Its controls bound this
exposure; they do not eliminate it.

## Declaration

A Resource Server advertises the extension in `PaymentRequired.extensions`:

```json
{
  "trc20ApprovalGasSponsoring": {
    "info": {
      "description": "The facilitator sponsors TRON Energy and Bandwidth for a pre-signed TRC-20 approve transaction.",
      "version": "1"
    },
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "description": {
          "const": "The facilitator sponsors TRON Energy and Bandwidth for a pre-signed TRC-20 approve transaction."
        },
        "from": {
          "type": "string",
          "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$"
        },
        "asset": {
          "type": "string",
          "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$"
        },
        "spender": {
          "type": "string",
          "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$"
        },
        "amount": {
          "const": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        },
        "signedTransaction": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "txID": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "raw_data_hex": {
              "type": "string",
              "pattern": "^(?:[0-9a-f]{2})+$",
              "maxLength": 16384
            },
            "signature": {
              "type": "array",
              "minItems": 1,
              "maxItems": 1,
              "items": {
                "type": "string",
                "pattern": "^[0-9a-f]{130}$"
              }
            }
          },
          "required": ["txID", "raw_data_hex", "signature"]
        },
        "version": {
          "const": "1"
        }
      },
      "required": [
        "from",
        "asset",
        "spender",
        "amount",
        "signedTransaction",
        "version"
      ]
    }
  }
}
```

The Base58Check `from`, `asset`, and `spender` fields and decimal `amount` are redundant display and
routing fields. The signed `raw_data_hex` bytes are authoritative, and each redundant field MUST
match the independently decoded transaction.

## Client payload

The client adds the extension only when the Server advertised it, the selected transfer method is
Permit2, and the allowance is zero. Core merges the client enrichment with the Server declaration
without allowing the client to replace the declared `description` or `version`:

```json
{
  "extensions": {
    "trc20ApprovalGasSponsoring": {
      "info": {
        "from": "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
        "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        "spender": "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
        "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        "signedTransaction": {
          "txID": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          "raw_data_hex": "0a02abcd",
          "signature": [
            "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"
          ]
        },
        "version": "1"
      }
    }
  }
}
```

The hexadecimal values above show the wire shape and are not a broadcastable test vector.

Before signing, the client MUST construct and inspect one `TriggerSmartContract` transaction with:

- `owner_address` equal to the payer;
- `contract_address` equal to the selected TRC-20 asset;
- calldata exactly equal to `approve(canonicalPermit2, MaxUint256)` with no trailing bytes;
- zero TRX and TRC-10 value;
- no memo or custom `permission_id`;
- recent TAPOS fields;
- a short expiration; and
- a `fee_limit` within the client's safety policy.

The client computes `txID = SHA-256(raw_data protobuf bytes)`, signs that digest, and supplies the
unchanged raw bytes and signature. The client MUST NOT broadcast the Approval when using this
extension. The separate Permit2 signature remains the authority for token, exact payment amount,
proxy spender, recipient witness, nonce, and deadline.

## Facilitator verification

The facilitator MUST independently validate the signed Approval. Client-provided display fields,
decoded JSON, and local client defaults are not security boundaries.

### Envelope and signature

The facilitator MUST:

1. require extension version exactly `"1"` and validate the advertised schema;
2. enforce input-size limits, exactly one signature, and no unknown JSON fields;
3. parse the exact `raw_data_hex` as TRON `Transaction.raw` protobuf;
4. reject malformed wire types, truncated or overlong encodings, unknown fields, duplicate singular
   fields, and fields outside this version's restricted profile;
5. recompute `SHA-256(raw_data_hex)` and match `signedTransaction.txID`;
6. validate the 65-byte secp256k1 signature and recover its signer; and
7. require signer, `owner_address`, extension `from`, and Permit2 payer to identify the same EOA.

The exact supplied bytes are authoritative for the transaction ID and signature. The facilitator
MUST NOT regenerate `raw_data_hex` from JSON or change TAPOS, timestamp, expiration, or `fee_limit`.
It may wrap the unchanged raw bytes and signature in the outer signed `Transaction` protobuf and use
TRON's `broadcasthex` API. The node-returned transaction ID MUST match the expected `txID`.

### Approval semantics

The decoded transaction MUST have:

- exactly one contract of type `TriggerSmartContract`;
- `owner_address` equal to the payer;
- `contract_address` equal to `PaymentRequirements.asset` and an allowlisted TRC-20 contract;
- calldata length exactly 68 bytes, selector `0x095ea7b3`, canonical Permit2 as spender, and
  `MaxUint256` as amount;
- no native or TRC-10 value, memo, additional contract, custom permission, or additional signature;
- an on-chain owner permission with threshold `1` that authorizes the recovered signer;
- valid TAPOS and timestamp fields;
- an expiration that leaves enough time to delegate and broadcast; and
- a `fee_limit` no higher than facilitator policy and sufficient for the current call estimate.

The Permit2 payment MUST independently bind and validate:

- x402 version, scheme, network, asset, amount, recipient, timeout, and required `extra` fields;
- payer and payment signature;
- exact Permit2 proxy spender;
- witness recipient equal to `PaymentRequirements.payTo`; and
- an active, unused nonce and deadline that covers the complete operation.

Approval spender and payment spender are intentionally different. The Approval authorizes canonical
Permit2, while the Permit2 signature authorizes the exact x402 proxy for one payment.

### Chain checks

`/verify` is read-only. It MUST NOT reserve or delegate resources, purchase resources, or broadcast
transactions. It checks that:

- the payer is an activated EOA using the supported owner permission;
- allowance is exactly zero and token balance covers the payment;
- token, Permit2, and settlement contracts exist on the selected network;
- the Approval call simulates successfully;
- current Energy and Bandwidth estimates are within configured caps; and
- a bounded sponsorship policy is available.

`/settle` MUST repeat all checks that can change, including allowance, balance, Permit2 nonce,
deadline, TAPOS, expiration, simulation, resource availability, and sponsorship policy. Any RPC,
decoding, simulation, or policy error on this sponsored path fails closed.

Recommended stable failure categories include `approval_extension_invalid`,
`approval_txid_mismatch`, `approval_signature_invalid`, `approval_semantics_invalid`,
`approval_payment_binding_mismatch`, `approval_not_required`, `approval_reset_required`,
`sponsor_policy_denied`, `resource_unavailable`, and `unknown_chain_state`.

## Settlement and resource sponsorship

The facilitator supplies resources only after it holds the final signed Approval and valid Permit2
payment. It MUST apply an idempotent, bounded sponsorship policy before creating a chain-side effect.
The policy may use authenticated tenant credit or a capped platform subsidy; this extension does not
define a new authentication, credit, or billing wire protocol.

### Resource sizing

Energy MUST be estimated against the actual payer, token, spender, and amount near settlement.
Deployments SHOULD add a bounded safety margin and MAY compare the current simulation with a rolling
historical percentile. Historical values never replace the current simulation.

For one signature, the pre-broadcast Bandwidth estimate follows the TRON transaction-size rule:

```text
requiredBandwidth = raw_data_hex.length / 2 + 3 + 67 + 64

stakedAvailable = max(NetLimit - NetUsed, 0)
freeAvailable = max(freeNetLimit - freeNetUsed, 0)

bandwidthToDelegate = 0
  if stakedAvailable >= requiredBandwidth
  or freeAvailable >= requiredBandwidth

bandwidthToDelegate = requiredBandwidth - stakedAvailable
  otherwise
```

Free and staked/delegated Bandwidth MUST NOT be added together. Either pool must independently cover
the complete transaction.

Resource units are converted to `DelegateResource.balance`, denominated in SUN, using current global
resource weights and limits:

```text
energyBalanceSun = 0
  if energyToDelegate == 0

energyBalanceSun = max(
  1_000_000,
  ceil(energyToDelegate * TotalEnergyWeight * 1_000_000 / TotalEnergyCurrentLimit)
)
  otherwise

bandwidthBalanceSun = 0
  if bandwidthToDelegate == 0

bandwidthBalanceSun = max(
  1_000_000,
  ceil(bandwidthToDelegate * TotalNetWeight * 1_000_000 / TotalNetLimit)
)
  otherwise
```

`energyToDelegate` is the required Energy, including the bounded margin, minus the payer's currently
available Energy. Positive delegation is subject to TRON's one-TRX minimum. The facilitator MUST
also verify the Resource Owner's currently delegatable balance and re-read the payer's actual
resources after delegation becomes visible.

A `DelegateResource` transaction selects one resource type. If both Energy and Bandwidth are needed,
the facilitator submits separate delegation actions and later separate matching reclamation actions.
It must also retain enough Resource Owner Bandwidth to execute every required reclamation.

### Execution order

After successful admission, the facilitator:

1. persists the immutable Approval and one action per required resource type;
2. broadcasts each `DelegateResource` action with `lock = false`;
3. confirms the required Energy and Bandwidth are visible on the payer;
4. rechecks mutable validation conditions;
5. broadcasts the exact payer-signed Approval;
6. waits for successful execution and independently observes the expected allowance;
7. immediately submits one matching `UnDelegateResource` action per delegated resource type; and
8. continues Permit2 settlement and tracks both payment finality and resource recovery.

Approval broadcast acceptance alone is not enough to reclaim. Reclamation begins after successful
execution and visible allowance state. Delegate, Approval, settlement, and undelegate are separate
TRON transactions; atomic or same-block execution is not guaranteed.

The payer-signed Approval is immutable and cannot be rebuilt after expiration. Facilitator-owned
actions may receive a new signed attempt only after the prior attempt is conclusively expired and
cannot still be included. RPC timeout or unknown chain state alone is not sufficient.

Undelegation returns the delegated stake share but does not immediately restore resources consumed
by the Approval. Unrecovered usage continues through TRON's recovery window. Implementations must
therefore distinguish clean available, reserved, delegated, and recovering capacity. Payment may be
final while resource recovery remains in progress.

Production implementations SHOULD persist action bytes and transaction IDs before broadcast,
prevent duplicate active operations for `(network, approvalTxID)`, reconcile unknown chain state,
and keep recovery processing available when new sponsorship is disabled. The specific database,
outbox, lease, and worker design is implementation-defined.

## Security considerations

### Account-level resource diversion

Stake 2.0 delegates to an account, not a transaction, token, method, or transaction ID. After the
resources become visible and before Approval consumes them, the payer can use them in another
transaction. Neither a stricter parser nor a facilitator-generated `prepare` transaction removes
this property.

Implementations SHOULD bound the exposure by obtaining the final signed Approval before delegation,
delegating only the minimum amount, broadcasting immediately after visibility, using short
expiration, allowing one active sponsorship per payer, and enforcing payer and global loss limits.

### Economic exhaustion

A valid Approval and a future Permit2 payment do not guarantee recovery of the sponsorship cost.
Attackers can use many EOAs, or make settlement fail after Approval. Before delegation, each request
MUST be covered by a bounded sponsor policy such as funded tenant credit or a capped platform subsidy.

Version `1` does not charge a user fee inside `approve`: standard TRC-20 `approve` changes allowance
and cannot simultaneously transfer a Sponsor Fee. A user collateral or split-payment format requires
a separate protocol extension.

### Operational guidance

Production deployments SHOULD separate Resource Owner, settlement, and treasury wallets; restrict
the online Resource Owner permission to delegation transaction types; enforce receiver, amount, and
rate policy in the signing service; avoid logging broadcastable signed Approvals; and distinguish
packed state from solidified finality.

## References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [`exact` on TRON](../schemes/exact/scheme_exact_tron.md)
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON Bandwidth estimation](https://developers.tron.network/docs/faq)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation on undelegation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
