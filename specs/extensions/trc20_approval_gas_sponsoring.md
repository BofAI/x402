# Extension: `trc20ApprovalGasSponsoring`

> **Status:** Draft
>
> **Target:** BANK OF AI TypeScript SDK 1.1.0
>
> **Extension version:** `1`

## Summary

`trc20ApprovalGasSponsoring` enables the first `exact + Permit2` payment from an activated TRON
externally owned account (EOA) that has no TRX and no existing TRC-20 allowance to Permit2. The
client constructs and signs, but does not broadcast, one transaction calling
`token.approve(canonicalPermit2, MaxUint256)`. The facilitator validates the signed transaction,
temporarily delegates the required Energy and, when needed, Bandwidth to the payer, broadcasts the
unchanged approval, settles the Permit2 payment, and reclaims the delegated resource share.

The extension follows the normal x402 extension flow. It does not add a prepare endpoint or require
an additional Resource Server-to-Facilitator request:

```text
PaymentRequired declares extension
  -> Client constructs and signs approval
  -> PaymentPayload carries signed approval
  -> Resource Server calls the existing /verify and /settle APIs
  -> Facilitator validates, delegates, broadcasts, settles, and reclaims
```

TRON resource delegation is account-scoped, not transaction-scoped. This extension therefore
cannot cryptographically reserve delegated Energy or Bandwidth for the approval transaction. The
security and economic controls in this document bound that exposure; they do not eliminate it.

## Scope

Version `1` is intentionally limited to:

- the [`exact` TRON binding](../schemes/exact/scheme_exact_tron.md) with
  `extra.assetTransferMethod = "permit2"`;
- activated, single-signature TRON EOAs using the default owner permission;
- allowlisted TRC-20 contracts and the configured canonical Permit2 deployment;
- a current token allowance of exactly zero;
- `approve(canonicalPermit2, MaxUint256)`;
- temporary Stake 2.0 delegation with `lock = false`; and
- Energy and Bandwidth supplied from a facilitator-managed resource pool.

Version `1` does not define:

- a new payment scheme;
- a facilitator `prepare` endpoint;
- smart-contract payers, custom active permissions, or multisignature approval transactions;
- reset-to-zero handling for a non-zero but insufficient allowance;
- a general-purpose Energy rental API;
- a user Sponsor Fee, collateral transfer, or token split-payment format;
- TRX transfers to the payer or automatic TRX burn fallback;
- GasFree-account settlement; or
- a wire protocol for external Energy providers.

If the allowance is already sufficient, the client MUST omit this extension. If the allowance is
non-zero but insufficient, version `1` MUST fail with `approval_reset_required` instead of
constructing a sponsored approval.

## Roles and trust boundaries

| Role | Responsibility |
| --- | --- |
| Client | Constructs the canonical approval, independently checks every field, and signs its `txID` |
| Resource Server | Declares the extension and uses the existing x402 verify/settle lifecycle |
| Facilitator | Strictly validates the approval and payment, controls admission, and orchestrates resources |
| Resource Owner | Holds staked TRX and signs only DelegateResource/UnDelegateResource operations |
| Settlement Wallet | Broadcasts the Permit2 settlement and MUST be separate from the Resource Owner |
| Payer EOA | Receives temporary resources and remains the signer and caller of the TRC-20 approval |

The Resource Server MUST NOT construct or modify the approval. The Facilitator MUST NOT replace any
byte covered by the payer signature. Resource Owner credentials MUST NOT be exposed through the
extension payload.

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

The Base58Check `from`, `asset`, and `spender` fields and the decimal `amount` field are redundant
display and routing fields. They are never authoritative. The signed `raw_data_hex` bytes are the sole
source of truth for approval semantics, and every redundant field MUST match the independently
decoded transaction.

`signedTransaction` is a compact protocol envelope rather than an arbitrary TronWeb transaction
object. The Facilitator MUST parse the exact `raw_data_hex` bytes for validation, then wrap those
unchanged bytes and the supplied signature in the outer signed `Transaction` protobuf for
broadcast. It MUST NOT trust or require a second client-supplied decoded `raw_data` object, and it
MUST NOT regenerate `raw_data_hex` from a JSON representation.

The extension declaration does not grant sponsorship. A deployment may advertise support while
rejecting a request because the authenticated tenant, budget, account, token, transaction, or
resource pool does not satisfy policy.

## Client payload

The client supplies the following enrichment for the same `PaymentPayload` that carries the Permit2
payment authorization. Core merges it with the Server declaration without allowing client fields to
overwrite the Server's `description` or `version`:

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

The hexadecimal values in this example are placeholders showing the wire shape, not a broadcastable
test vector.

### Client construction requirements

Before signing, the client MUST independently build and inspect a transaction with all of the
following properties:

1. `raw_data.contract` contains exactly one `TriggerSmartContract`.
2. `owner_address` is the payer represented by `from`.
3. `contract_address` is the selected TRC-20 `asset`.
4. Contract calldata is exactly `approve(address,uint256)` with no trailing bytes.
5. The calldata spender is the canonical Permit2 address for `accepted.network`.
6. The calldata amount is `MaxUint256`.
7. `call_value` and `call_token_value` are absent or zero, and `token_id` is absent.
8. Transaction memo data is absent.
9. `permission_id` is absent or zero.
10. TAPOS references a recent block on the selected network.
11. `timestamp`, `expiration`, and `fee_limit` satisfy the client safety policy.

The client MUST compute `txID = SHA-256(raw_data protobuf bytes)`, sign that digest, and include the
unchanged raw bytes. Signing an approval does not authorize any payment by itself. The separate
Permit2 signature binds payment token, amount, exact proxy spender, recipient witness, nonce, and
deadline.

A client MUST NOT automatically fall back to constructing or broadcasting a self-funded approval
after the Server selected this extension. It may return an explicit error and let the caller choose a
different payment path.

## Facilitator verification

The same validation rules MUST be shared by `/verify`, `/settle`, and the pre-broadcast gate. A
Facilitator MUST NOT maintain a weaker settlement validator.

### 1. Envelope and signed transaction bytes

The Facilitator MUST:

1. require the extension to have been declared by the Resource Server and require version exactly
   `"1"`;
2. enforce the JSON Schema, byte-size limits, exactly one signature, and no unknown JSON fields;
3. decode `raw_data_hex` as TRON `Transaction.raw` protobuf;
4. reject malformed wire types, truncated or overlong encodings, unknown fields, duplicate singular
   fields, and any field outside this specification's restricted transaction profile;
5. recompute `SHA-256(raw_data_hex)` and require it to equal `signedTransaction.txID`;
6. validate the 65-byte secp256k1 signature, require canonical low-`s`, and recover the signer; and
7. require the signer, decoded `owner_address`, extension `from`, and Permit2 payment payer to
   identify the same activated EOA.

The exact supplied `raw_data_hex`, rather than a protobuf reserialization, is authoritative for
`txID` and signature verification. The Facilitator MUST persist those bytes, the `txID`, and the
signature before any chain-side effect. For broadcast it MUST construct the outer signed
`Transaction` envelope around the unchanged raw bytes and signature, for example through TRON's
`/wallet/broadcasthex` API. It MUST NOT rebuild the raw transaction to refresh its TAPOS fields,
expiration, timestamp, or `fee_limit`, and the node-returned transaction ID MUST equal the expected
`txID`.

### 2. Approval semantics

The decoded transaction MUST satisfy all of the following:

- exactly one contract with type and type URL for `TriggerSmartContract`;
- `owner_address` matches the payer;
- `contract_address` matches `PaymentRequirements.asset` and a local token allowlist;
- calldata length is exactly 68 bytes including the four-byte selector;
- selector is `approve(address,uint256)` (`0x095ea7b3`);
- spender is the locally configured canonical Permit2 deployment, not an address selected by the
  payload;
- amount is `MaxUint256` and matches the redundant extension `amount`;
- TRX value and TRC-10 value are zero;
- memo data, additional contracts, custom permission, and additional signatures are absent;
- the on-chain owner permission has threshold `1`, contains exactly one effective signing key, and
  authorizes the recovered signer with sufficient weight;
- `fee_limit` provides enough execution budget for the current Energy estimate under network rules
  and is no higher than the deployment hard cap;
- TAPOS refers to the selected network and remains valid;
- `timestamp` is not unreasonably in the future or past; and
- `expiration` is within the configured maximum lifetime and leaves enough time for delegation and
  broadcast.

Policy limits such as maximum transaction lifetime, minimum remaining broadcast window, and maximum
`fee_limit` are trusted Facilitator configuration. The Facilitator MUST NOT load them from client-
supplied extension fields.

### 3. Approval-to-payment binding

The Facilitator MUST verify the complete `exact + Permit2` authorization and bind it to the approval:

- `paymentPayload.accepted` matches the trusted `PaymentRequirements` for protocol version, scheme,
  network, asset, amount, recipient, timeout, and required `extra` fields;
- Approval payer, Permit2 `from`, and verified payment signer match;
- Approval token and Permit2 `permitted.token` match the required asset;
- Permit2 `permitted.amount` equals the exact required amount;
- Permit2 authorization spender is the configured x402 exact proxy;
- Permit2 witness recipient equals `PaymentRequirements.payTo`;
- Permit2 nonce is unused, deadline leaves enough time for the full operation, and `validAfter` is
  active; and
- the Permit2 signature is valid for the configured network, Permit2 contract, and payer.

The TRC-20 approval spender and Permit2 authorization spender are intentionally different: the
approval grants allowance to canonical Permit2, while the Permit2 signature authorizes the x402
exact proxy to consume a specific payment.

### 4. Read-only chain and resource checks

`/verify` MUST remain free of reservations, delegation, resource purchases, broadcasts, and other
state-changing side effects. It MUST perform read-only checks sufficient to predict admission:

- payer account exists, is activated, and is not a contract account;
- current token allowance to Permit2 is exactly zero;
- payer token balance covers the exact payment amount;
- token and configured contracts exist on the selected network;
- the approval call can be simulated successfully;
- required Energy is estimated from the actual owner, token, spender, and amount;
- required Bandwidth is computed from `raw_data_hex`, the exact signature count, and the transaction
  result allowance defined by the TRON resource model;
- estimated values remain below per-transaction hard caps; and
- the configured resource pool is not already below its safety headroom.

Any RPC, decoding, simulation, or policy-loading error on the sponsored path MUST fail closed. The
optimistic allowance and balance fallback allowed by the standard self-funded `exact` path does not
apply to this extension.

## Resource calculation

The Facilitator MUST calculate Energy and Bandwidth independently.

```text
targetEnergy = ceil(max(currentSimulation, rollingP95ForTokenAndMethod) * safetyFactor)
energyToDelegate = max(targetEnergy - payerAvailableEnergy, 0)
```

`currentSimulation` MUST be refreshed near settlement. Historical values and safety factors are
capacity inputs, not substitutes for the current simulation. Dynamic Energy parameters and contract
state can change between verification and broadcast. Until a token and method have enough accepted
samples for a reliable rolling percentile, `rollingP95ForTokenAndMethod` MUST fall back to
`currentSimulation`.

For a transaction with `n` signatures, the pre-broadcast Bandwidth estimate is:

```text
signedTransactionBandwidth = raw_data_hex.length / 2 + 3 + 67 * n + 64

stakedAvailable = max(NetLimit - NetUsed, 0)
freeAvailable = max(freeNetLimit - freeNetUsed, 0)

bandwidthToDelegate = 0
  if stakedAvailable >= signedTransactionBandwidth
  or freeAvailable >= signedTransactionBandwidth

bandwidthToDelegate = signedTransactionBandwidth - stakedAvailable
  otherwise
```

Version `1` requires `n = 1`. The final receipt is authoritative for actual usage.

`energyToDelegate` and `bandwidthToDelegate` are resource units, while
`DelegateResource.balance` is a staked-balance share denominated in SUN. The Facilitator MUST load
fresh global resource values and convert with integer rational arithmetic, rounding up:

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

The `1_000_000` SUN floor reflects TRON's minimum delegation of one TRX per resource action. Before
constructing the action, the Facilitator MUST also require `balanceSun` not to exceed the Resource
Owner's result from `wallet/getcandelegatedmaxsize` for that resource. The conversion is a
point-in-time estimate because global limits and weights can change. After each delegation becomes
visible, the Facilitator MUST re-read the payer's actual resource limits and MUST NOT broadcast the
Approval unless the required resources are present.

Bandwidth pools MUST NOT be added together. The transaction is covered when either:

- available staked/delegated Bandwidth independently covers the complete signed transaction; or
- available free Bandwidth independently covers the complete signed transaction.

If neither pool independently covers it, delegated Bandwidth MUST make the staked/delegated pool
cover the complete transaction. The Facilitator MUST also reserve enough Resource Owner Bandwidth
for every current DelegateResource operation and every future UnDelegateResource operation before
it accepts a new sponsorship. A DelegateResource transaction selects exactly one resource type.
Therefore Energy and Bandwidth sponsorship requires two separate delegation actions and two matching
reclamation actions.

The target is zero unexpected payer TRX consumption. A deployment conforming to version `1` MUST
reject admission or broadcast when sponsored resources are insufficient and MUST NOT deliberately
rely on protocol-level TRX burn as a fallback.

## Settlement lifecycle

`/settle` is the only entry point allowed to start sponsored side effects. It MUST re-run all critical
static, cryptographic, chain, and resource checks against the same signed bytes.

### Admission transaction

Before any chain-side effect, the Facilitator MUST atomically:

1. authenticate the calling tenant or Resource Server;
2. require that tenant to be authorized for `PaymentRequirements.payTo`;
3. reserve a funded Sponsor Credit or explicit subsidy budget sufficient for the bounded worst-case
   resource loss;
4. enforce payer, tenant, payee, token, time-bucket, and global quotas;
5. ensure the payer has no other non-terminal Sponsor operation;
6. create an operation uniquely keyed by `(network, approvalTxID)`;
7. persist immutable Approval and Payment digests;
8. reserve clean Energy, any required Bandwidth, and future recovery Bandwidth; and
9. persist one durable outbox action for each required resource type before broadcasting.

If the database or durable outbox is unavailable, the Facilitator MUST NOT Delegate resources. A
public, unauthenticated `/settle` request MUST NOT be able to trigger sponsorship.

### Chain sequence

After admission, the Facilitator performs the following recoverable sequence:

1. broadcast the persisted DelegateResource action for each required resource type with
   `lock = false`;
2. confirm that the intended Energy and Bandwidth are actually visible on the payer account;
3. recheck expiration, TAPOS, allowance, operation lease, resource visibility, and immutable digests;
4. broadcast the exact signed Approval bytes;
5. wait for a successful Approval receipt and independently observe the expected Permit2 allowance;
6. submit Permit2 settlement and one matching UnDelegateResource action per delegated resource type
   as separate, recoverable actions; and
7. track settlement finality, undelegation finality, and the Resource Owner's recovering capacity.

Approval broadcast acceptance alone is not sufficient to reclaim resources. Reclamation may begin
only after the Approval has executed successfully and its allowance state is visible. A low-latency
deployment SHOULD submit UnDelegateResource immediately after that point; it MUST still reconcile
packed versus solidified chain state and MUST NOT report final success until its configured finality
condition is met.

Each DelegateResource, Approval, Permit2 settlement, and each UnDelegateResource action is a separate
TRON transaction. The protocol does not guarantee that they execute atomically or within one block.
In normal operation, reclamation can be submitted in the first block-processing cycle after
Approval state becomes visible, but same-block reclamation is not guaranteed.

### Operation states

A conforming implementation MUST distinguish business completion from resource completion. An
illustrative state model is:

```text
VALIDATED
  -> RESERVED
  -> DELEGATION_ACTIONS_SUBMITTED
  -> RESOURCES_VISIBLE
  -> APPROVAL_SUBMITTED
  -> APPROVAL_STATE_VISIBLE
       |-> PAYMENT_SUBMITTED -> PAYMENT_FINAL
       `-> RECLAIM_ACTIONS_SUBMITTED -> RECLAIM_FINAL -> RECOVERING -> RESOURCE_TERMINAL
```

`UNKNOWN_CHAIN_STATE` is not a terminal failure. While any action has unknown status, the
Facilitator MUST stop dependent side effects, query the original transaction ID, and reconcile. It
MUST NOT construct a replacement action with a new transaction ID merely because an RPC response was
lost.

The same HTTP request may be retried, but `(network, approvalTxID)` MUST bind to at most one Sponsor
operation. Every logical chain action MUST persist each signed attempt, transaction ID, attempt
number, and fencing token before its first broadcast. Workers may replay the same bytes while an
attempt is valid. The payer-signed Approval is immutable and MUST never be rebuilt. A
Facilitator-signed DelegateResource, UnDelegateResource, or settlement action may receive a new
attempt only after the previous transaction is conclusively expired and cannot still be included;
an RPC timeout or unknown chain state alone is not sufficient. The new attempt remains attached to
the same logical action and operation.

## Reclamation and recovery accounting

UnDelegateResource returns the delegated stake share to the Resource Owner. It does not restore
Energy or Bandwidth already consumed by the Approval. The recipient's proportional unrecovered
resource usage is transferred back to the Resource Owner and continues recovering over the TRON
resource recovery window.

Consequently:

- `RECLAIM_FINAL` MUST NOT make consumed capacity immediately allocatable;
- clean available, reserved, delegated, and recovering capacity MUST be tracked separately;
- admission MUST use clean allocatable capacity, not nominal stake ownership;
- recovery workers MUST continue when new sponsorship is disabled; and
- a sweeper MUST reconcile database records with actual on-chain delegations.

The operation may report `PAYMENT_FINAL` while resource accounting remains in `RECOVERING`.

## Security considerations

### Account-level resource diversion

Stake 2.0 delegates resources to an account. It cannot bind them to an Approval transaction, token,
contract, selector, or transaction ID. After resources become visible and before Approval consumes
them, the payer can submit a different transaction that spends the delegated resources.

No stricter Approval parser and no Facilitator-generated prepare transaction can remove this chain
property. Implementations MUST bound the loss with all of the following controls:

- obtain and validate the final signed Approval before delegation;
- delegate only the minimum approved resource amount;
- broadcast immediately after resource visibility;
- use a short transaction lifetime and one active operation per payer;
- enforce authenticated tenant credit and multi-dimensional quotas;
- stop new sponsorship when loss, recovery backlog, or pool headroom crosses a limit; and
- measure adversarial resource-diversion success in pre-production testing.

### Economic exhaustion and Sybil requests

A valid Approval signature is not payment for sponsored resources. Approval and Permit2 settlement
are non-atomic, and a payer can make the later payment fail. An attacker can also use many activated
EOAs to bypass per-address limits.

Before delegation, every operation MUST have an identified economic sponsor: funded tenant credit,
a funded platform subsidy budget, or another non-revocable balance. Merely observing the payer's
token balance or a future Permit2 signature is not collateral. Version `1` does not define a user fee
inside `approve`; standard TRC-20 `approve` changes allowance and cannot transfer a Sponsor Fee.

### Resource Owner key isolation

The online Resource Owner permission SHOULD be restricted to DelegateResource and
UnDelegateResource transaction types. TRON permissions do not natively restrict receiver, amount,
or daily total, so the signing service MUST independently enforce those fields and per-wallet limits.
The owner permission SHOULD remain offline, resource pools SHOULD be split into bounded shards, and
the Resource Owner MUST remain separate from settlement and treasury wallets.

### Finality, expiry, and recovery races

Packed receipts are not equivalent to solidified state. If a deployment proceeds after state is
visible but before solidification, it MUST set an explicit provisional exposure limit and reconcile
reorganizations. An Approval that might still enter a block MUST NOT be undelegated merely because a
single RPC endpoint timed out; premature reclamation can make the Approval fail or burn payer TRX.

### Sensitive transaction data

The signed Approval is immediately broadcastable until expiry. Implementations MUST avoid logging
the full envelope, SHOULD encrypt it at rest, SHOULD restrict operator access, and SHOULD delete the
raw signature and transaction bytes after the retention period while preserving audit hashes and
transaction IDs.

## Stable error categories

Implementations SHOULD expose stable machine-readable reasons, including:

- `approval_extension_invalid_format`
- `approval_extension_version_unsupported`
- `approval_payload_too_large`
- `approval_raw_data_invalid`
- `approval_raw_data_mismatch`
- `approval_txid_mismatch`
- `approval_signature_invalid`
- `approval_signer_mismatch`
- `approval_contract_structure_invalid`
- `approval_owner_mismatch`
- `approval_asset_mismatch`
- `approval_spender_invalid`
- `approval_amount_invalid`
- `approval_value_not_zero`
- `approval_permission_not_allowed`
- `approval_timestamp_invalid`
- `approval_transaction_expired`
- `approval_tapos_invalid`
- `approval_fee_limit_exceeded`
- `approval_not_required`
- `approval_reset_required`
- `approval_payment_binding_mismatch`
- `payer_account_not_activated`
- `payer_account_not_eoa`
- `sponsor_authentication_required`
- `sponsor_payto_not_authorized`
- `sponsor_credit_insufficient`
- `sponsor_quota_exceeded`
- `resource_unavailable`
- `operation_in_progress`
- `approval_transaction_reused`
- `unknown_chain_state`
- `approval_failed`

An error response SHOULD state whether retrying the identical payload is safe. Expired Approval
transactions require a newly constructed and signed transaction with a new `txID`.

## Conformance requirements

Before advertising this extension on mainnet, an implementation MUST test:

- valid restricted protobuf vectors and malformed, duplicate, unknown-field, and overlong encodings;
- one-bit mutations of raw bytes, transaction ID, and signature;
- wrong network, payer, token, Permit2, amount, selector, recipient, nonce, and deadline;
- trailing calldata, memo, extra contracts, value, custom permissions, and multiple signatures;
- expired and near-expiry transactions, invalid TAPOS, and fee limits above policy;
- allowance transitions and the non-zero insufficient allowance case;
- simulation drift and Dynamic Energy changes;
- concurrent duplicate settlements and process failure at every persisted chain-action boundary;
- RPC response loss, partial delegation, packed-state reorganization, and recovery restart;
- an adversarial payer racing a different Energy-consuming transaction; and
- reconciliation of clean, reserved, delegated, and recovering capacity over a full recovery window.

Mainnet rollout MUST begin with all safety controls enabled, a small allowlist, one token, low daily
budgets, and one active Sponsor operation per payer. Canary scope reduces exposure; it does not waive
validation, accounting, recovery, or authentication requirements.

## References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [`exact` on TRON](../schemes/exact/scheme_exact_tron.md)
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON Bandwidth estimation](https://developers.tron.network/docs/faq)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation on undelegation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
