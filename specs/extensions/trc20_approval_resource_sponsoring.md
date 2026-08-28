# Extension: `trc20ApprovalResourceSponsoring`

## Summary

`trc20ApprovalResourceSponsoring` enables the first supported Permit2 payment or channel deposit from
an activated TRON externally owned account (EOA) without requiring the payer to hold or burn TRX. The
Client signs, but does not broadcast, a transaction calling
`token.approve(canonicalPermit2, MaxUint256)`. The Facilitator validates the signed transaction and
the selected Scheme's payment authorization, temporarily delegates the required Energy and, when
needed, Bandwidth to the payer, broadcasts the unchanged Approval, reclaims the delegated resource
share through durable asynchronous recovery, and continues the selected settlement or deposit
without waiting for reclamation confirmation.

The extension uses the normal x402 flow. It does not add a `prepare` endpoint or require an additional
Resource Server interaction.

Version `1` supports:

- the [`exact` TRON binding](../schemes/exact/scheme_exact_tron.md) with
  `extra.assetTransferMethod = "permit2"`;
- the [`upto` TRON binding](../schemes/upto/scheme_upto_tron.md), which always uses Permit2;
- the Permit2 `deposit` path of the
  [`batch-settlement` TRON binding](../schemes/batch-settlement/scheme_batch_settlement_tron.md),
  including an initial deposit or later top-up;
- activated, single-signature EOAs using the default owner permission;
- zero allowance under the default `zero-first` Approval update strategy, or an insufficient
  non-zero allowance only when the token is explicitly configured as `direct-overwrite`;
- `approve(canonicalPermit2, MaxUint256)`; and
- temporary Stake 2.0 delegation with `lock = false`.

The extension is not used for EIP-3009 transfers or for `batch-settlement` voucher, claim, settle, or
refund payloads that do not carry a Permit2 deposit.

A non-zero but insufficient allowance fails with `approval_reset_required` under `zero-first`.
The Extension never inserts an implicit `approve(0)` transaction. This extension does not define a
general resource-rental API, a Sponsor Fee, collateral, GasFree-account settlement, or an external
Energy-provider protocol.

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
      "properties": {
        "from": { "type": "string", "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
        "asset": { "type": "string", "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
        "spender": { "type": "string", "pattern": "^T[1-9A-HJ-NP-Za-km-z]{33}$" },
        "amount": {
          "const": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
        },
        "signedTransaction": {
          "type": "string",
          "pattern": "^(?:[0-9a-f]{2})+$",
          "maxLength": 16384
        },
        "version": { "const": "1" }
      },
      "required": ["from", "asset", "spender", "amount", "signedTransaction", "version"]
    }
  }
}
```

`signedTransaction` is the lowercase hexadecimal encoding, without a `0x` prefix, of the complete
signed TRON `Transaction` protobuf. Its exact bytes are authoritative. The redundant display fields
`from`, `asset`, `spender`, and `amount` MUST match the independently decoded transaction.

The version 1 Client MUST create a signed Approval with at least 600 seconds of remaining transaction
lifetime. This is a fixed Client SDK requirement, not Server-provided capability information. The
Facilitator MUST independently enforce its locally configured saga window before delegation.
`fee_limit` bounds remain independent Client and Facilitator policy and are not Client payload fields.

## Client payload

The Client adds the extension only when the Server advertised version `"1"`, the selected transfer
method is Permit2, the current allowance is insufficient, the token Approval policy permits an
update, and the selected path is one of:

- an `exact` payment;
- an `upto` payment; or
- a `batch-settlement` payload with `type = "deposit"` for an initial deposit or top-up.

A `batch-settlement` voucher-only or other non-deposit payload MUST NOT carry the extension. When
using this extension, the Client MUST return the signed Approval to the Facilitator and MUST NOT
broadcast it itself.

```json
{
  "extensions": {
    "trc20ApprovalResourceSponsoring": {
      "info": {
        "from": "TJRyWwFs9wTFGZg3JbrVriFbNfCug5tDeC",
        "asset": "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf",
        "spender": "TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h",
        "amount": "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        "signedTransaction": "0a...",
        "version": "1"
      }
    }
  }
}
```

The abbreviated hexadecimal value above shows the wire shape and is not a broadcastable test vector.

Before any allowance read or signing operation, the Client signer MUST prove that its exact network
equals `PaymentRequirements.network`. A sponsored Approval MUST NOT use a wildcard or unbound
signer. Before signing, the Client MUST construct and inspect one `TriggerSmartContract` transaction with:

- `owner_address` equal to the payer;
- `contract_address` equal to the selected TRC-20 asset;
- calldata exactly equal to `approve(canonicalPermit2, MaxUint256)` with no trailing bytes;
- zero TRX and TRC-10 value;
- no memo or custom `permission_id`;
- recent TAPOS fields;
- an expiration that preserves at least the fixed version 1 Client lifetime; and
- a `fee_limit` within the Client's local safety policy.

The Client computes `txID = SHA-256(raw_data protobuf bytes)`, signs that digest, and serializes the
complete transaction containing the unchanged `raw_data` and exactly one signature.

The Approval authorizes only canonical Permit2 to spend the token. The separate Scheme payload
remains authoritative for all payment-specific fields:

- `exact` binds the exact amount, settlement proxy, recipient, nonce, and deadline;
- `upto` binds the authorized maximum, upto proxy, recipient, Facilitator, validity window, nonce,
  and deadline; and
- `batch-settlement` binds the deposit amount, Permit2 deposit collector, and channel ID, while the
  separately signed voucher binds the channel's cumulative claimable amount.

The Client MUST construct and validate the complete Scheme payload before signing the Approval. An
Approval alone is not a payment, deposit, or voucher authorization.

## Facilitator verification

Before accepting the extension, the Facilitator MUST:

1. require extension version exactly `"1"` and validate the Client `info` fields against its locally
   pinned version `1` schema;
2. decode the exact `signedTransaction` bytes as a TRON `Transaction` protobuf, reject malformed,
   duplicate, unknown, or unsupported fields, and require exactly one `raw_data` and one 65-byte
   signature;
3. compute `approvalTxID = SHA-256(raw_data)` and validate the java-tron-compatible secp256k1
   signature;
4. require the recovered signer, `owner_address`, extension `from`, and Permit2 payer to identify the
   same activated EOA using the supported owner permission;
5. require exactly one `TriggerSmartContract` call whose target equals `PaymentRequirements.asset`
   and an allowlisted TRC-20 contract;
6. require calldata exactly equal to `approve(canonicalPermit2, MaxUint256)` and match the decoded
   asset, spender, and amount to the extension display fields;
7. reject native value, TRC-10 value, memo, additional contracts, additional signatures, and custom
   permissions;
8. validate TAPOS, timestamp, expiration, and a sufficient remaining broadcast window;
9. require `fee_limit` to cover the current Energy estimate without exceeding the Facilitator's
   local hard cap or the network maximum;
10. require `PaymentPayload.accepted.scheme` to match `PaymentRequirements.scheme`, require the
    selected Scheme and payload path to be supported by version `1`, and fully verify that Scheme's
    payload before accepting sponsorship:
    - for `exact`, verify network, payer, asset, exact amount, settlement proxy, `payTo`, nonce, and
      deadline;
    - for `upto`, verify network, payer, asset, signed maximum, upto proxy, `payTo`, bound Facilitator,
      `validAfter`, nonce, deadline, and that the requested settlement amount cannot exceed the
      signed maximum; and
    - for `batch-settlement`, require a Permit2 `deposit` payload and verify the channel
      configuration and ID, payer, asset, configured deposit collector, deposit amount, Permit2
      nonce and deadline, voucher signature, cumulative amount, and post-deposit balance bounds;
11. require the current allowance to satisfy the configured token Approval strategy, sufficient
    token balance for the exact payment, upto maximum, or batch deposit as applicable, and successful
    simulation of the exact signed Approval; and
12. estimate the required Energy and Bandwidth and reject the request when resource or sponsorship
    policy limits are exceeded.

The signed transaction is immutable. The Facilitator MUST broadcast the exact bytes supplied by the
Client and MUST require the node-returned transaction ID to equal the computed `approvalTxID`.

`/verify` is read-only and MUST NOT reserve, delegate, purchase, broadcast, deposit, or settle.
`/settle` MUST repeat all mutable checks immediately before creating a chain-side effect. Any
decoding, signature, simulation, RPC, Scheme validation, or policy error on the sponsored path fails
closed.

The Approval update policy is keyed by canonical network and normalized token address:

- `zero-first` permits a new Approval only when allowance is zero and rejects a non-zero insufficient
  allowance with `approval_reset_required`;
- `direct-overwrite` permits the canonical Max Approval over a non-zero insufficient allowance and
  MUST be configured explicitly for that token; and
- `unsupported` rejects the asset without signing, broadcasting, or delegating.

An already sufficient allowance continues without an Approval under every strategy. Allowlisted and
built-in supported Permit2 assets default to `zero-first`; unknown assets default to `unsupported`.
Client self-funded Approval, Client sponsored Approval, and Facilitator admission MUST apply the same
strategy result.

## Settlement and resource sponsorship

The Facilitator supplies resources only after it holds both the final signed Approval and a valid
authorization for the selected supported Scheme. `(network, approvalTxID)` MUST identify at most one
sponsorship operation so concurrent or retried `/settle` calls cannot create duplicate delegations.
Scheme-specific settlement, channel, deposit, and voucher idempotency remain independently governed
by their respective Scheme specifications and MUST NOT be replaced by the sponsorship operation key.

Settlement proceeds in this order:

1. reject before admission when the payment authorization deadline or Approval transaction lifetime
   cannot cover the configured sponsorship saga, then estimate Energy and Bandwidth requirements and
   apply bounded safety margins;
2. reserve sufficient sponsorship capacity under the Facilitator's local policy;
3. submit one unlocked `DelegateResource` transaction for each required resource type;
4. confirm the delegated Energy and Bandwidth are visible and sufficient on the payer;
5. repeat mutable Approval and Scheme-specific payment or deposit checks and confirm that the
   payment deadline still covers the settlement safety margin;
6. broadcast the exact payer-signed Approval;
7. confirm successful execution and independently observe the expected allowance;
8. repeat Scheme-specific authorization checks after Approval confirmation, durably record the
   recovery debt, and immediately attempt to prepare, persist, and submit a
   matching `UnDelegateResource` transaction for every successful delegation;
9. perform one final Scheme validation and continue with the `exact` or `upto` Permit2 settlement,
   or the `batch-settlement` Permit2 deposit, without waiting for `UnDelegateResource` confirmation;
   and
10. asynchronously confirm or reconcile every original `UnDelegateResource` transaction before
    releasing the reserved Resource Owner capacity.

Energy and Bandwidth are separate TRON resource types and therefore require separate delegation and
reclamation transactions when both are needed. The Facilitator MUST NOT broadcast the Approval until
the required resources are visible and sufficient, and MUST NOT deliberately rely on burning the
payer's TRX as a fallback.

If allowance becomes sufficient before the Approval is broadcast, the Facilitator skips the
Approval. Any resource already delegated MUST enter durable recovery before the selected settlement
or deposit continues. The Facilitator MUST immediately attempt to prepare, durably persist, and
submit the matching `UnDelegateResource`. If preparation, persistence of the prepared action,
broadcast, or confirmation cannot complete after the recovery debt is durable, the operation MUST
remain recoverable and a worker MUST continue it asynchronously. Such a recovery failure MUST NOT
turn an otherwise valid payment or deposit into a settlement failure. An implementation MUST NOT
continue settlement if it cannot first persist the recovery debt itself.

For `upto`, when the Resource Server selects an actual settlement amount of zero, the Facilitator
MUST NOT delegate resources or broadcast the Approval and MUST follow the Scheme's zero-settlement
path. For `batch-settlement`, the Approval and sponsorship operation apply only to the Permit2
deposit or top-up; subsequent voucher-only requests use the established channel and MUST NOT repeat
sponsorship.

After any successful delegation, Approval failure, expiration, timeout, caller disconnection,
settlement failure, or deposit failure MUST NOT strand resources on the payer. If no immutable
Undelegate action was persisted, a recovery worker MAY prepare one. Once an action is persisted and
its chain result is unknown, the Facilitator MUST reconcile the original transaction ID before
retrying or reclaiming and MUST NOT create a replacement while the original may still be included. A
replacement Undelegate MAY be prepared only after the original transaction is confirmed failed.

Delegate, Approval, Undelegate, and the selected settlement or deposit are separate TRON
transactions. Atomic or same-block execution is not guaranteed. The `transaction` in a successful
core `SettleResponse` is the final `exact`/`upto` settlement or `batch-settlement` deposit transaction
ID, not a delegation, Approval, or reclamation transaction ID.

On any sponsorship failure, core `SettleResponse.transaction` MUST be an empty string. A locally
computed or merely prepared Approval transaction ID is not evidence of a submitted payment and MUST
NOT be exposed through that field. Implementations MAY retain the Approval transaction ID internally
for idempotency and recovery once its durable action state is known.

Undelegation returns the delegated stake share but does not immediately restore consumed resources.
Unrecovered usage remains subject to TRON's recovery window, so recovering capacity MUST NOT be
treated as clean available capacity until the Resource Owner's usable resources are observed again.

## Security considerations

### Account-level resource diversion

Stake 2.0 delegates resources to an account, not to a transaction, token, method, or transaction ID.
After resources become visible and before the Approval consumes them, the payer can use them in
another transaction. This risk cannot be removed by stricter Approval validation.

Implementations SHOULD obtain the final signed Approval before delegation, delegate only the minimum
required amount, allow only one active sponsorship per payer, broadcast immediately after resource
visibility, use short transaction expiration, and enforce payer and global loss limits.

### Economic exhaustion

A valid Approval does not guarantee that the later payment or batch deposit will succeed or reimburse
sponsorship cost. Before delegation, each request MUST be covered by a bounded sponsorship policy,
such as funded tenant credit or a capped platform subsidy. The Facilitator MUST reject sponsorship
unless the complete Scheme-specific authorization has already passed verification. This extension
does not charge a user fee inside `approve`; standard TRC-20 `approve` changes allowance and cannot
simultaneously transfer a fee.

### Replay and recovery

`(network, approvalTxID)` idempotency protects only Facilitators sharing the same sponsorship state.
Independent Facilitators can still sponsor the same signed Approval. Deployments SHOULD route one
sponsorship through one Facilitator domain and enforce bounded exposure.

Implementations MUST persist enough operation and transaction identity to resume reconciliation and
resource reclamation after RPC errors, process restarts, or request disconnection. The persistence,
worker, locking, monitoring, and storage design is implementation-defined.

### Resource Owner signing

The Resource Owner MUST use a non-owner Active Permission that authorizes `DelegateResourceContract`
and `UnDelegateResourceContract`. A generic opaque transaction-signing callback is insufficient.
The signing boundary MUST receive the intended network, action, owner, receiver, resource, stake
amount, unlocked policy, and permission ID.

Before signing, the Facilitator and Resource Owner signer MUST decode the authoritative `raw_data`
protobuf and require exactly one expected contract, exact intent-field equality, `lock = false` for
delegation, the configured non-zero Active Permission ID, and no memo, scripts, auths, fee limit, or
additional contracts. After signing, the `raw_data` bytes and locally recomputed transaction ID MUST
remain identical to the validated unsigned transaction.

## References

- [Core x402 v2 specification](../x402-specification-v2.md)
- [`exact` on TRON](../schemes/exact/scheme_exact_tron.md)
- [`upto` on TRON](../schemes/upto/scheme_upto_tron.md)
- [`batch-settlement` on TRON](../schemes/batch-settlement/scheme_batch_settlement_tron.md)
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON `fee_limit`](https://developers.tron.network/docs/set-feelimit)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
