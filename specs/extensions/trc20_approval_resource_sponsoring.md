# Extension: `trc20ApprovalResourceSponsoring`

> **Status:** Draft
>
> **Target:** BANK OF AI TypeScript SDK 1.1.0
>
> **Extension version:** `1`

## Summary

`trc20ApprovalResourceSponsoring` enables the first `exact + Permit2` payment from an activated TRON
externally owned account (EOA) without requiring the payer to hold or burn TRX and when no existing
TRC-20 allowance to Permit2 is available. The client constructs and signs, but does not broadcast, a
transaction calling `token.approve(canonicalPermit2, MaxUint256)`. The facilitator strictly validates
that transaction, temporarily delegates the required Energy and, when needed, Bandwidth to the payer,
broadcasts the unchanged approval, settles the Permit2 payment, and reclaims the delegated resource
share.

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
settlement, an external Energy-provider protocol, or a provider-bound `SponsorIntent`. A non-zero but
insufficient allowance fails with `approval_reset_required`.

The extension version is independent of the BANK OF AI SDK release version. Backward-compatible
clarifications may retain version `"1"`; an incompatible wire shape, validation contract, state
meaning, or error/retry contract requires a new extension version.

TRON resource delegation is account-scoped, not transaction-scoped. The extension cannot
cryptographically reserve delegated resources for the Approval transaction. Its controls bound this
exposure; they do not eliminate it.

## Capability advertisement

A Facilitator MUST include `trc20ApprovalResourceSponsoring` in the `extensions` array returned by
`GET /supported` only when it has registered the TRON `exact + Permit2` mechanism and an enabled
sponsorship runtime that can validate Approvals, reserve resources and policy budget, delegate,
broadcast, reclaim, and resume recovery after restart. Transient runtime unavailability MUST fail new
sponsorship closed but MUST NOT stop recovery for existing operations.

A Resource Server MUST advertise this extension only when its selected Facilitator reports the key
and the selected payment requirement uses the TRON `exact` scheme with
`extra.assetTransferMethod = "permit2"`. This capability check uses the existing `/supported`
initialization flow and adds no per-payment request. Clients MUST process only extension version
`"1"`; an unknown version MUST NOT be treated as compatible.

The core `extensions` array is not scoped per network or `SupportedKind`. A Facilitator that returns
this key MUST therefore enable version `1` for every TRON `exact + Permit2` kind it advertises in the
same response. A deployment supporting sponsorship for only a subset MUST separate those kinds into
a compatible Facilitator endpoint or omit the key.

## Declaration

A Resource Server advertises the extension in `PaymentRequired.extensions`:

```json
{
  "trc20ApprovalResourceSponsoring": {
    "info": {
      "description": "The facilitator sponsors TRON Energy and Bandwidth for a pre-signed TRC-20 approve transaction.",
      "version": "1",
      "minApprovalLifetimeSeconds": 120,
      "maxApprovalLifetimeSeconds": 600,
      "maxFeeLimitSun": "20000000"
    },
    "schema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256
        },
        "minApprovalLifetimeSeconds": {
          "type": "integer",
          "minimum": 1
        },
        "maxApprovalLifetimeSeconds": {
          "type": "integer",
          "minimum": 1
        },
        "maxFeeLimitSun": {
          "type": "string",
          "pattern": "^[0-9]+$"
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
        "description",
        "from",
        "asset",
        "spender",
        "amount",
        "signedTransaction",
        "version",
        "minApprovalLifetimeSeconds",
        "maxApprovalLifetimeSeconds",
        "maxFeeLimitSun"
      ]
    }
  }
}
```

The Base58Check `from`, `asset`, and `spender` fields and decimal `amount` are redundant display and
routing fields. The signed `raw_data_hex` bytes are authoritative, and each redundant field MUST
match the independently decoded transaction.

The lifetime and fee values above are illustrative deployment policy, not network constants. The
minimum lifetime MUST be no greater than the maximum. A Client uses the declaration as an early
safety bound. For a new operation, the Facilitator reloads its authoritative current policy during
`/verify` and `/settle` and rejects a declaration echo outside that policy. An existing operation
instead compares the echo with its stored declaration and admission snapshot and reuses that snapshot.
A hard safety revocation MAY block its next not-yet-submitted payment side effect, but policy change
MUST NOT block reconciliation by original transaction ID, undelegation, recovery, or retrieval of a
stored terminal result. Human-readable `description` text is not a protocol constant and MAY be
localized without changing the extension version.

## Client payload

The client adds the extension only when all of the following are true:

- the Server advertised version `"1"` for the selected payment requirement;
- the selected transfer method is Permit2;
- the client can construct, inspect, and sign the restricted Approval transaction; and
- the current allowance is exactly zero.

When these conditions hold, this extension takes precedence over the base TRON client's local
`approve` broadcast: the client MUST return the signed Approval to the Facilitator and MUST NOT also
broadcast it. If the extension is not advertised or supported, the client may use the base
self-funded Approval flow or choose another payment requirement. A non-zero but insufficient
allowance MUST fail with `approval_reset_required`; it MUST NOT be overwritten automatically.

The following object is the Client enrichment fragment before Core merge. Core merges it with the
Server declaration without allowing the Client to replace Server-controlled policy fields. The final
wire object therefore also contains the declaration's `description`, lifetime bounds, and
`maxFeeLimitSun`:

```json
{
  "extensions": {
    "trc20ApprovalResourceSponsoring": {
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

The hexadecimal values above show the Client enrichment wire shape and are not a broadcastable test
vector.

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

1. require extension version exactly `"1"` and validate merged `info` with a locally compiled,
   canonical version `1` schema selected by extension key and version;
2. enforce input-size limits, exactly one signature, and no unknown JSON fields;
3. parse the exact `raw_data_hex` as TRON `Transaction.raw` protobuf under the restricted encoding
   profile below;
4. reject malformed wire types, truncated or overlong encodings, non-minimal varints, fields out of
   profile order, unknown fields, duplicate singular fields, and fields outside that profile;
5. recompute `SHA-256(raw_data_hex)` and match `signedTransaction.txID`;
6. validate the 65-byte java-tron-compatible secp256k1 `r || s || recovery-id` signature and recover
   its signer; and
7. require signer, `owner_address`, extension `from`, and Permit2 payer to identify the same EOA.

The exact supplied bytes are authoritative for the transaction ID and signature. The facilitator
MUST NOT regenerate `raw_data_hex` from JSON or change TAPOS, timestamp, expiration, or `fee_limit`.
It may wrap the unchanged raw bytes and signature in the outer signed `Transaction` protobuf and use
TRON's `broadcasthex` API. The node-returned transaction ID MUST match the expected `txID`.

A request-carried `schema`, if present, is never a validation authority. The Facilitator either
ignores it or requires byte-for-byte equality with its locally pinned schema. It independently checks
the echoed lifetime and fee-policy fields against its authoritative local policy.

#### Restricted transaction encoding

Protobuf does not define a universal canonical serialization across all runtimes. Version `1`
therefore defines a restricted java-tron-compatible profile rather than relying on generic
"canonical protobuf":

- every message uses the official java-tron field numbers and wire types;
- tags, integer values, and lengths use their shortest valid varint encoding;
- fields appear in ascending field-number order;
- unknown fields and duplicate singular fields are forbidden;
- `Transaction.raw` contains only `ref_block_bytes`, `ref_block_hash`, `expiration`, exactly one
  `contract`, `timestamp`, and `fee_limit`; `ref_block_num`, `auths`, memo `data`, `scripts`, and all
  other fields are absent;
- the contract contains only `type` and `parameter`; `type` is `TriggerSmartContract`, the Any
  `type_url` is exactly `type.googleapis.com/protocol.TriggerSmartContract`, and `provider`,
  `ContractName`, and `Permission_id` are absent; and
- `TriggerSmartContract` contains only `owner_address`, `contract_address`, and `data`; `call_value`,
  `call_token_value`, `token_id`, and unknown fields are absent.

After parsing, the Facilitator MUST deterministically re-encode this restricted profile with the
same official schema and require byte-for-byte equality with `raw_data_hex`. This rule rejects
alternate encodings before any resource reservation or delegation; it does not claim that arbitrary
protobuf messages have a canonical form.

All hexadecimal fields in this extension are lowercase and omit a `0x` prefix. Every displayed TRON
address MUST pass Base58Check checksum validation, decode to exactly 21 bytes beginning with network
prefix `0x41`, and re-encode to the identical string. When comparing with a 20-byte address inside a
TIP-712 authorization, the implementation strips `0x41` only after successful Base58Check decoding
and compares the remaining bytes, never presentation strings.

### Approval semantics

The decoded transaction MUST have:

- exactly one contract of type `TriggerSmartContract`;
- `owner_address` equal to the payer;
- `contract_address` equal to `PaymentRequirements.asset` and an entry in the facilitator-controlled
  hard allowlist for the selected network;
- calldata length exactly 68 bytes, selector `0x095ea7b3`, canonical Permit2 as spender, and
  `MaxUint256` as amount;
- no native or TRC-10 value, memo, additional contract, custom permission, or additional signature;
- an on-chain owner permission with threshold `1` that authorizes the recovered signer;
- `ref_block_bytes` of exactly 2 bytes and `ref_block_hash` of exactly 8 bytes that identify an
  accepted recent canonical block under TRON TAPOS;
- a required timestamp within the Facilitator's configured past-age and future-clock-skew bounds;
- an expiration that satisfies the quantified admission rule in
  [Expiration admission](#expiration-admission); and
- a `fee_limit` that satisfies the live lower and upper bounds below.

Clients SHOULD derive TAPOS from the latest solidified block available to them. The Facilitator MUST
independently validate the referenced block against the selected network's recent 65,536-block TAPOS
window and MUST fail closed when its validation node exceeds the configured head-lag limit.

The Approval lifetime `expiration - timestamp` MUST fall within the declared minimum and maximum.
Independently, at `/verify`, `/settle`, and immediately before Approval broadcast, java-tron network
validity requires `currentHeadBlockTime < expiration` and
`expiration <= currentHeadBlockTime + MAXIMUM_TIME_UNTIL_EXPIRATION` (currently 24 hours). The
Approval must also satisfy the remaining-lifetime checkpoints below. The Facilitator computes the fee
bounds using the current Energy estimate and live chain parameters:

```text
requiredFeeLimitSun =
  requiredCallerEnergyIncludingMargin * liveEnergyFeeSunPerUnit

maximumFeeLimitSun = min(
  declared maxFeeLimitSun,
  facilitator local policy limit,
  current network getMaxFeeLimit
)

requiredFeeLimitSun <= signed fee_limit <= maximumFeeLimitSun
```

The Client MUST additionally apply its own local hard cap before signing. Unless a Token deployer's
Energy contribution and available balance are pinned in policy and rechecked at settlement, sizing
MUST conservatively assume the payer covers 100 percent of the call Energy. `fee_limit` limits the
call's Energy budget regardless of whether that Energy is delegated or burned; it does not cap
Bandwidth and does not itself guarantee zero TRX burn.

The effective Token allowlist MUST be the facilitator's global `(network, token)` hard allowlist
intersected with any seller-specific allowlist. `PaymentRequirements`, extension fields, and seller
registration may select from that intersection but MUST NOT expand it. The Token's current code
identity, including any configured proxy implementation identity, MUST match the facilitator's local
admission record. Simulation MUST use the exact Client-signed calldata and owner represented by
`raw_data_hex`.

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
- a new sponsorship has allowance exactly zero, while token balance covers the payment;
- Token, any configured Token implementation, Permit2, the exact settlement proxy, and any configured
  proxy implementation match Facilitator-pinned code identities on the selected network;
- the Approval call simulates successfully;
- current Energy and Bandwidth estimates are within configured caps; and
- a bounded sponsorship policy is available.

After the cheap local envelope and transaction-ID checks, `/settle` MUST first load by
`(network, approvalTxID)` and compare the immutable external request binding. A terminal operation
returns its stored result. An operation with a submitted or unknown action first reconciles the
original transaction ID. An existing non-terminal operation repeats only the mutable checks that
remain applicable before its next unsubmitted side effect. Only when no operation exists does
`/settle` run the complete new-admission checks, including allowance, balance, Permit2 nonce,
deadline, TAPOS, expiration, simulation, resource availability, and sponsorship policy. Any RPC,
decoding, simulation, or policy error on this sponsored path fails closed.

Allowance zero is an eligibility condition for creating a new sponsorship operation, not a condition
that remains true after the Approval succeeds. The state rules are:

- before any chain-side effect, a sufficient allowance makes sponsorship a no-op and the Facilitator
  may continue normal Permit2 verification or settlement;
- a new operation with `0 < allowance < required allowance` fails with
  `approval_reset_required`;
- a known operation may resume with allowance zero while its Approval has not succeeded, or with a
  sufficient allowance after that Approval succeeds; and
- every other non-zero insufficient state fails closed and enters reconciliation or recovery when
  the known operation has already created a side effect.

For an existing `(network, approvalTxID)`, `/verify` may only read the stored operation, compare its
binding, and report whether the identical payload remains eligible; it MUST NOT claim a worker lease,
advance state, or broadcast. Only `/settle` may resume and advance the stored operation. Neither path
may reclassify it as a new sponsorship merely because allowance has changed.

A production deployment that offers non-disposable seller or tenant sponsorship SHOULD authenticate
both sponsored `/verify` and `/settle` requests. It MUST authenticate `/settle` before consuming such
a budget and bind the authenticated principal to a stable seller identity, authorized `payTo` and
network values, a Token-allowlist subset, quotas, cost attribution, and audit records. The
authentication mechanism is outside this extension. An anonymous tier MAY exist only under an
explicitly configured, disposable subsidy with small payer, rate, and global hard caps.

The following stable categories are part of version `1`'s error and retry contract. `/verify` places
the code in `invalidReason`; `/settle` places it in `errorReason` and returns an empty core
`transaction` when `success` is false.

| Code | Phase | Retry contract |
| --- | --- | --- |
| `approval_extension_invalid` | verify, settle | Terminal for this payload; reconstruct it. |
| `approval_txid_mismatch` | verify, settle | Terminal for this payload; reconstruct and re-sign it. |
| `approval_signature_invalid` | verify, settle | Terminal for this payload; re-sign it. |
| `approval_semantics_invalid` | verify, settle | Terminal for this Approval; construct a conforming Approval. |
| `approval_payment_binding_mismatch` | verify, settle | Terminal for this Approval/Payment pair. |
| `approval_reset_required` | verify, settle | Terminal until allowance is safely reset outside version `1`. |
| `approval_transaction_expiring` | verify, settle | Construct and sign a new Approval; do not mutate the old one. |
| `sponsor_idempotency_conflict` | settle | Terminal for the conflicting binding; never reuse the txID with different semantics. |
| `sponsor_policy_denied` | verify, settle | Retry only after the reported policy condition changes. |
| `resource_unavailable` | verify, settle | Retry only after capacity changes, normally with a fresh Approval if its lifetime is insufficient. |

## Settlement and resource sponsorship

The facilitator supplies resources only after it holds the final signed Approval and valid Permit2
payment. It MUST apply an idempotent, bounded sponsorship policy before creating a chain-side effect.
The policy may use authenticated tenant credit or a capped platform subsidy; this extension does not
define a new authentication, credit, or billing wire protocol.

Before the first chain-side effect, the facilitator MUST atomically reserve all required Energy and
Bandwidth capacity and charge or reserve a specific facilitator-controlled sponsorship-policy
budget. Request fields MUST NOT create or expand that budget. Reserved, delegated, and recovering
capacity MUST continue counting against it until clean usable capacity is observed again.

`(network, approvalTxID)` MUST identify at most one sponsorship operation. Concurrent and retried
`/settle` calls for the same Approval MUST return or resume that operation and MUST NOT create an
additional delegation.

That operation MUST bind an immutable external request fingerprint containing at least:

- the exact signed Approval bytes and transaction ID;
- the Permit2 authorization and Payment payload digest;
- the canonical PaymentRequirements, including network, asset, amount, `payTo`, timeout, and required
  `extra` values;
- the authenticated tenant or the explicit anonymous subsidy tier, as applicable;
- the extension version.

The operation separately stores an immutable internal execution snapshot containing the admitted
sponsorship-policy and budget identity, selected Resource Owner, rounded resource-leg balances, and
policy version. The same `(network, approvalTxID)` with an identical external fingerprint resumes the
existing operation and reuses that snapshot. The same key with any different external binding fails
with `sponsor_idempotency_conflict` before a side effect.

The create path MUST use one durable atomic admission transaction to create the operation, store both
bindings, reserve policy budget and clean capacity, select and freeze the Resource Owner, and persist
the immutable logical resource-leg plan with every rounded `DelegateResource.balance` in SUN. This
transaction creates logical action identities, not broadcastable signed attempts. The load path MUST
only verify the external fingerprint and reuse the existing operation, reservation, owner, snapshot,
and legs; it MUST NOT reserve or charge again or select replacement execution parameters.

A terminal failure before any chain-side effect releases the reservation atomically. After any side
effect may have occurred, only reconciliation and the defined reclamation path may release it.

Across all instances in one sponsorship deployment, the facilitator MUST serialize admission for
`(network, payer)`. At most one sponsorship for that key may hold reserved or delegated resources
until every resource leg is known not to have succeeded or has been confirmed undelegated. Mutations
for `(network, resourceOwner, payer, resourceType)` MUST also be serialized. Admission, capacity, and
resource-leg state MUST be shared across the deployment; process-local synchronization is not
sufficient.

### Resource sizing

Energy MUST be estimated against the actual payer, token, spender, and amount near settlement.
The Facilitator MUST add a bounded safety margin and MAY compare the current simulation with a
rolling historical percentile. Historical values never replace the current simulation. The margin
policy MUST either size against a pinned upper bound for the allowlisted Token's Dynamic Energy
factor, or ensure the Approval window cannot cross the next maintenance boundary and apply both a
configured minimum percentage and minimum absolute-Energy margin. If neither bound can be established,
new sponsorship fails closed.

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

All chain integers and resource arithmetic MUST use exact integer semantics. TypeScript
implementations MUST decode chain `int64` values directly to `bigint`, validate positivity and range,
perform multiplication and ceiling division as `bigint`, and convert to JSON or SDK values only at a
checked boundary. Energy and Bandwidth weights and limits used in one conversion MUST come from the
same accepted chain snapshot and must be non-zero.

Capacity and sponsor-budget accounting MUST use the actual rounded SUN balance persisted for each
resource leg, the resulting acquired resource amount, and all management Bandwidth—not the unrounded
resource shortfall. Before broadcasting a leg, the Facilitator MUST verify the Resource Owner's
current `getCanDelegatedMaxSize` result for that resource type.

A `DelegateResource` transaction selects one resource type. If both Energy and Bandwidth are needed,
the facilitator submits separate delegation actions and later separate matching reclamation actions.
It MUST reserve enough Resource Owner Bandwidth for every Delegate and Undelegate action, expected
recovery retries, signer or KMS overhead, and maintenance headroom before admitting the operation.
If a deployment allows Resource Owner TRX burn as an emergency management fallback, that spend MUST
be separately capped, attributed, and recorded as sponsorship cost; it MUST NOT be an unbounded
implicit fallback.

Resource visibility is not established solely by a payer account-resource total. For each leg the
Facilitator MUST observe successful execution of the persisted Delegate transaction, verify the
expected delegated-balance delta for the persisted `lock = false` leg on
`(resourceOwner, payer, resourceType)` through `getdelegatedresourcev2`, and then verify that the
payer's actual available resource independently covers the signed Approval. The Resource
Owner/receiver edge MUST be under this coordinator's exclusive mutation control while an operation
is active.

If every successful delegation is visible but actual resources remain insufficient, version `1`
MUST NOT create an unplanned top-up and MUST NOT broadcast the Approval. It MUST reclaim every
successful leg, preserve the reservation until reclamation and recovery are accounted for, and return
`resource_unavailable`.

### Expiration admission

"Enough time" MUST be a calculated deployment policy rather than a qualitative check. At every
checkpoint the Facilitator computes separate Approval and Payment requirements:

```text
minimumApprovalLifetime =
  worstCaseVisibilityTime(all uncompleted delegation legs)
  + approvalSubmissionAndInclusionTimeout
  + configuredSafetyMargin

minimumPaymentLifetime =
  worstCaseVisibilityTime(all uncompleted delegation legs)
  + approvalSubmissionAndInclusionTimeout
  + dependentActionGateTime
  + settlementSubmissionAndInclusionTimeout
  + configuredSafetyMargin
```

`approval.expiration - currentChainTime` MUST be at least `minimumApprovalLifetime`, and the Permit2
authorization deadline minus current chain time MUST be at least `minimumPaymentLifetime`, before
capacity reservation, immediately before broadcasting each `DelegateResource` leg, and immediately
before broadcasting the Approval. The Payment deadline MUST be checked once more before settlement
submission. At a checkpoint after all delegation legs are visible, the remaining-delegation term is
zero. The configured bounds MUST account for the execution strategy, current network behavior, clock
skew, RPC skew, and the deployment's finality policy. `dependentActionGateTime` may be zero only when
the configured policy permits settlement after packed Approval success and independently visible
allowance; when the policy waits for Approval solidification, it MUST cover the worst-case
solidification delay. Failure after any successful delegation creates a reclamation obligation.

TRON transaction timestamps and expiration are milliseconds, while the Permit2 deadline is Unix
seconds in a decimal string. Implementations MUST parse both as exact integers, convert them to one
unit with checked `bigint` arithmetic, and never compare the raw values or pass them through
floating-point numbers.
Post-inclusion solidification is governed by the separate finality and recovery policy because
transaction expiration controls inclusion, not later solidification.

### Execution order

After successful admission, the facilitator:

1. loads the persisted immutable Approval and logical resource-leg plan and prepares one signed
   Delegate attempt per required resource type under the durable-before-broadcast rule below;
2. broadcasts each persisted `DelegateResource` attempt with `lock = false`;
3. confirms the required Energy and Bandwidth are visible on the payer;
4. rechecks mutable validation conditions;
5. broadcasts the exact payer-signed Approval;
6. waits for successful execution and independently observes the expected allowance;
7. immediately submits one matching `UnDelegateResource` action per delegated resource type; and
8. continues Permit2 settlement and tracks both payment finality and resource recovery.

The facilitator MUST NOT broadcast the Approval until the required resources are actually visible
and sufficient. Version `1` MUST NOT deliberately rely on burning the payer's TRX as a fallback.

If allowance becomes sufficient before any resource leg is broadcast, the facilitator MUST skip
sponsorship, atomically mark the sponsorship path as a no-op, release all capacity and budget that has
not produced a chain-side effect, and MAY then continue normal Permit2 settlement. If allowance
becomes sufficient after a successful delegation but before Approval broadcast, the facilitator MUST
reclaim every successful resource leg and MAY continue settlement while recovery proceeds.

Approval broadcast acceptance establishes neither successful execution nor terminal failure. The
facilitator MUST reconcile the original Approval transaction ID until successful execution and the
expected allowance are observed, or a terminal failure is known. After success, and after every known
terminal failure following a successful delegation, it MUST submit and confirm a matching
`UnDelegateResource` action for every successful resource leg.

Partial delegation, post-delegation validation failure, expiration, TAPOS or payment-nonce failure,
confirmed Approval failure, caller timeout, and caller disconnection MUST NOT strand a successful
resource leg. An unknown chain state MUST stop dependent side effects and be reconciled through the
original transaction ID; it MUST NOT cause a replacement side effect. Reconciliation and recovery
continue independently of the request lifecycle.

Delegate, Approval, settlement, and undelegate are separate TRON transactions; atomic or same-block
execution is not guaranteed.

Each chain action MUST distinguish at least `SUBMITTED`, `PACKED_SUCCESS`, `SOLIDIFIED_SUCCESS`,
known terminal failure, and unknown chain state. For `TriggerSmartContract`, `PACKED_SUCCESS` requires
a successful FullNode `GetTransactionInfoById` execution receipt; broadcast acceptance or merely
finding the transaction body is insufficient. A FullNode receipt does not establish irreversible
finality; solidification MUST be confirmed through a SolidityNode or an equivalent irreversible-block
view. A deployment MAY submit a dependent action after `PACKED_SUCCESS` only when the required state
is independently visible on the same accepted canonical head and the resulting provisional exposure
is explicitly bounded. Otherwise it waits for solidification. A packed receipt alone MUST NOT release
budget or clean capacity.

The core `SettleResponse` has the following meaning for this extension:

- `success: true` means the Permit2 payment settlement reached `SOLIDIFIED_SUCCESS`;
- `transaction` is the Permit2 payment settlement transaction ID, never a Delegate, Approval, or
  Undelegate transaction ID;
- a terminal failure has `success: false`, an empty `transaction`, and its stable `errorReason`; and
- once payment succeeds, pending or failed reclamation MUST NOT rewrite the stored payment result.

Version `1` does not add a public pending or recovery-status wire field. The Facilitator MUST NOT
encode a non-terminal operation or unknown chain outcome as a failed `SettleResponse`. `/settle`
waits or resumes internally until the Payment reaches a terminal result. If its transport connection
ends first, no `SettleResponse` has been produced: the durable operation continues, and the Resource
Server MUST retry the identical PaymentPayload rather than request or construct a new Payment. That
retry attaches to the same operation and eventually returns the stored terminal result.

Resource reclamation and clean-capacity recovery continue internally after a successful payment
response. They do not delay or rewrite that terminal payment result.

The payer-signed Approval is immutable and cannot be rebuilt after expiration. Facilitator-owned
actions may receive a new signed attempt only after the prior attempt is conclusively expired and
cannot still be included. RPC timeout or unknown chain state alone is not sufficient.

Undelegation returns the delegated stake share but does not immediately restore resources consumed
by the Approval. Unrecovered usage continues through TRON's recovery window. Implementations MUST
distinguish clean available, reserved, delegated, and recovering capacity. Reserved capacity MUST
remain unavailable until each leg is known not to have succeeded or its matching undelegation is
confirmed. Undelegated but consumed resources MUST NOT become clean available until the Resource
Owner's actual usable capacity is observed again. Payment may be final while recovery remains in
progress.

Before broadcast or submission network I/O for every chain action, the facilitator MUST durably
persist, atomically with the state transition that makes the attempt broadcastable, its immutable
signed transaction bytes, transaction ID, sponsorship and logical-action (including resource-leg)
identity, state, and attempt number. It MUST broadcast those exact bytes. An indeterminate broadcast
MUST be reconciled by the persisted transaction ID and MUST NOT create a replacement side effect.
An action without complete signed bytes, transaction ID, and attempt number MUST NOT be marked
broadcastable.

Where lease-based workers are used, their coordination state MUST include a fencing generation and
stale workers MUST be prevented from advancing or broadcasting an attempt. Recovery processing MUST
remain available when new sponsorship is disabled. The specific database, outbox, lease, and worker
design is implementation-defined.

## Security considerations

### Account-level resource diversion

Stake 2.0 delegates to an account, not a transaction, token, method, or transaction ID. After the
resources become visible and before Approval consumes them, the payer can use them in another
transaction. Neither a stricter parser nor a facilitator-generated `prepare` transaction removes
this property.

Implementations SHOULD bound the exposure by obtaining the final signed Approval before delegation,
delegating only the minimum amount, broadcasting immediately after visibility, using short
expiration, allowing one active sponsorship per payer, and enforcing payer and global loss limits.

There remains a race between the final resource check and Approval inclusion. If the payer consumes
delegated Energy or Bandwidth in that interval, the Approval can fail or, when the payer has TRX,
consume TRX under TRON's normal resource rules up to the applicable transaction limits. Version `1`
MUST recheck immediately before broadcast and MUST NOT intentionally fund this path with payer TRX,
but it cannot cryptographically guarantee zero payer burn against concurrent payer activity. This
residual risk MUST be disclosed by deployments that advertise a resource-sponsored user experience.

### Cross-facilitator replay

The Resource Server can observe and rebroadcast the signed Approval. It can also submit the same
Approval and Permit2 authorization to independent facilitators. `(network, approvalTxID)` idempotency
protects only facilitators that share one sponsorship state domain; it does not prevent two
independent facilitators from separately delegating resources before either observes the allowance.

Version `1` accepts this as a residual risk because it does not include a Client-signed,
provider-bound `SponsorIntent`. Deployments SHOULD route a sponsorship through one selected
facilitator domain and MUST enforce payer, seller or subsidy-tier, and global hard exposure limits
without assuming that other facilitator domains share state. Those limits bound only this
deployment's contribution to cross-provider loss. A future hardened version may bind `approvalTxID`
to a verifiable facilitator domain or encrypt delivery to the selected facilitator.

### Economic exhaustion

A valid Approval and a future Permit2 payment do not guarantee recovery of the sponsorship cost.
Attackers can use many EOAs, or make settlement fail after Approval. Before delegation, each request
MUST be covered by a bounded sponsor policy such as funded tenant credit or a capped platform subsidy.
Payer, seller or subsidy-tier, Token, time-window, and global quotas MUST count reserved, delegated,
and recovering capacity until that capacity becomes clean again.

Version `1` does not charge a user fee inside `approve`: standard TRC-20 `approve` changes allowance
and cannot simultaneously transfer a Sponsor Fee. A user collateral or split-payment format requires
a separate protocol extension.

### Operational guidance

Production deployments SHOULD separate Resource Owner, settlement, and treasury wallets; restrict
the online Resource Owner permission to delegation transaction types; enforce receiver, amount, and
rate policy in the signing service; avoid logging broadcastable signed Approvals; and distinguish
packed state from solidified finality. They SHOULD monitor allowlisted Token bytecode, proxy
implementation identity, canonical Permit2 and settlement proxy code, and allowlist-policy version;
a code identity that no longer matches the local admission record MUST be removed from sponsorship
until it is reviewed and re-admitted.

## References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [`exact` on TRON](../schemes/exact/scheme_exact_tron.md)
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON `fee_limit`](https://developers.tron.network/docs/set-feelimit)
- [TRON Bandwidth estimation](https://developers.tron.network/docs/faq)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation on undelegation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
- [java-tron transaction ID implementation](https://github.com/tronprotocol/java-tron/blob/develop/chainbase/src/main/java/org/tron/core/capsule/TransactionCapsule.java)
