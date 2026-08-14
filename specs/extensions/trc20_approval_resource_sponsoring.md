# Extension: `trc20ApprovalResourceSponsoring`

> **Status:** Draft
>
> **Target:** BANK OF AI TypeScript SDK 1.1.0
>
> **Extension version:** `1`

## Summary

`trc20ApprovalResourceSponsoring` enables the first `exact + Permit2` payment from an activated TRON
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
settlement, an external Energy-provider protocol, or a provider-bound `SponsorIntent`. A non-zero but
insufficient allowance fails with `approval_reset_required`.

TRON resource delegation is account-scoped, not transaction-scoped. The extension cannot
cryptographically reserve delegated resources for the Approval transaction. Its controls bound this
exposure; they do not eliminate it.

## Declaration

A Resource Server advertises the extension in `PaymentRequired.extensions`:

```json
{
  "trc20ApprovalResourceSponsoring": {
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
- `contract_address` equal to `PaymentRequirements.asset` and an entry in the facilitator-controlled
  hard allowlist for the selected network;
- calldata length exactly 68 bytes, selector `0x095ea7b3`, canonical Permit2 as spender, and
  `MaxUint256` as amount;
- no native or TRC-10 value, memo, additional contract, custom permission, or additional signature;
- an on-chain owner permission with threshold `1` that authorizes the recovered signer;
- valid TAPOS and timestamp fields;
- an expiration that satisfies the quantified admission rule in
  [Expiration admission](#expiration-admission); and
- a `fee_limit` no higher than facilitator policy and sufficient for the current call estimate.

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
- allowance is exactly zero and token balance covers the payment;
- token, Permit2, and settlement contracts exist on the selected network;
- the Approval call simulates successfully;
- current Energy and Bandwidth estimates are within configured caps; and
- a bounded sponsorship policy is available.

`/settle` MUST repeat all checks that can change, including allowance, balance, Permit2 nonce,
deadline, TAPOS, expiration, simulation, resource availability, and sponsorship policy. Any RPC,
decoding, simulation, or policy error on this sponsored path fails closed.

A production deployment that offers non-disposable seller or tenant sponsorship SHOULD authenticate
both sponsored `/verify` and `/settle` requests. It MUST authenticate `/settle` before consuming such
a budget and bind the authenticated principal to a stable seller identity, authorized `payTo` and
network values, a Token-allowlist subset, quotas, cost attribution, and audit records. The
authentication mechanism is outside this extension. An anonymous tier MAY exist only under an
explicitly configured, disposable subsidy with small payer, rate, and global hard caps.

Recommended stable failure categories include `approval_extension_invalid`,
`approval_txid_mismatch`, `approval_signature_invalid`, `approval_semantics_invalid`,
`approval_payment_binding_mismatch`, `approval_not_required`, `approval_reset_required`,
`approval_transaction_expiring`, `sponsor_operation_in_progress`, `sponsor_policy_denied`,
`resource_unavailable`, and `unknown_chain_state`.

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

Across all instances in one sponsorship deployment, the facilitator MUST serialize admission for
`(network, payer)`. At most one sponsorship for that key may hold reserved or delegated resources
until every resource leg is known not to have succeeded or has been confirmed undelegated. Mutations
for `(network, resourceOwner, payer, resourceType)` MUST also be serialized. Admission, capacity, and
resource-leg state MUST be shared across the deployment; process-local synchronization is not
sufficient.

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
It MUST also retain enough Resource Owner Bandwidth to execute every required reclamation.

### Expiration admission

"Enough time" MUST be a calculated deployment policy rather than a qualitative check. At every
checkpoint the facilitator computes:

```text
minimumRemainingLifetime =
  worstCaseVisibilityTime(all uncompleted delegation legs)
  + approvalSubmissionAndInclusionTimeout
  + configuredSafetyMargin
```

`approval.expiration - currentChainTime` MUST be at least `minimumRemainingLifetime` before capacity
reservation, immediately before broadcasting each `DelegateResource` leg, and immediately before
broadcasting the Approval. At the final checkpoint the remaining-delegation term is zero. The
configured bounds MUST account for the execution strategy, current network behavior, clock skew,
and RPC skew. Failure after any successful delegation creates a reclamation obligation.
Post-inclusion solidification is governed by the separate finality and recovery policy because
transaction expiration controls inclusion, not later solidification.

### Execution order

After successful admission, the facilitator:

1. durably persists the immutable Approval and one action per required resource type;
2. broadcasts each `DelegateResource` action with `lock = false`;
3. confirms the required Energy and Bandwidth are visible on the payer;
4. rechecks mutable validation conditions;
5. broadcasts the exact payer-signed Approval;
6. waits for successful execution and independently observes the expected allowance;
7. immediately submits one matching `UnDelegateResource` action per delegated resource type; and
8. continues Permit2 settlement and tracks both payment finality and resource recovery.

The facilitator MUST NOT broadcast the Approval until the required resources are actually visible
and sufficient. Version `1` MUST NOT deliberately rely on burning the payer's TRX as a fallback.

If allowance becomes sufficient before any resource leg is broadcast, the facilitator MUST skip
sponsorship and MAY continue normal Permit2 settlement. If it becomes sufficient after a successful
delegation but before Approval broadcast, the facilitator MUST reclaim every successful resource leg
and MAY continue settlement while recovery proceeds.

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
implementation identity, and allowlist-policy version; a code identity that no longer matches the
local admission record MUST be removed from sponsorship until it is reviewed and re-admitted.

## References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [`exact` on TRON](../schemes/exact/scheme_exact_tron.md)
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON Bandwidth estimation](https://developers.tron.network/docs/faq)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation on undelegation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
