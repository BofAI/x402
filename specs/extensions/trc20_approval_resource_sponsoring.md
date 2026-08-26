# Extension: `trc20ApprovalResourceSponsoring`

## Summary

`trc20ApprovalResourceSponsoring` enables the first `exact + Permit2` payment from an activated TRON
externally owned account (EOA) without requiring the payer to hold or burn TRX. The Client signs, but
does not broadcast, a transaction calling `token.approve(canonicalPermit2, MaxUint256)`. The
Facilitator validates the signed transaction, temporarily delegates the required Energy and, when
needed, Bandwidth to the payer, broadcasts the unchanged Approval, reclaims the delegated resource
share through durable asynchronous recovery, and settles the Permit2 payment without waiting for
reclamation confirmation.

The extension uses the normal x402 flow. It does not add a `prepare` endpoint or require an additional
Resource Server interaction.

Version `1` supports:

- the [`exact` TRON binding](../schemes/exact/scheme_exact_tron.md) with
  `extra.assetTransferMethod = "permit2"`;
- activated, single-signature EOAs using the default owner permission;
- an allowance of exactly zero;
- `approve(canonicalPermit2, MaxUint256)`; and
- temporary Stake 2.0 delegation with `lock = false`.

A non-zero but insufficient allowance fails with `approval_reset_required`. This extension does not
define a general resource-rental API, a Sponsor Fee, collateral, GasFree-account settlement, or an
external Energy-provider protocol.

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
        "amount": { "const": "115792089237316195423570985008687907853269984665640564039457584007913129639935" },
        "signedTransaction": { "type": "string", "pattern": "^(?:[0-9a-f]{2})+$", "maxLength": 16384 },
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

Approval lifetime and `fee_limit` bounds are local Client and Facilitator policy, not Extension wire
fields.

## Client payload

The Client adds the extension only when the Server advertised version `"1"`, the selected transfer
method is Permit2, and the current allowance is exactly zero. When using this extension, the Client
MUST return the signed Approval to the Facilitator and MUST NOT broadcast it itself.

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

Before signing, the Client MUST construct and inspect one `TriggerSmartContract` transaction with:

- `owner_address` equal to the payer;
- `contract_address` equal to the selected TRC-20 asset;
- calldata exactly equal to `approve(canonicalPermit2, MaxUint256)` with no trailing bytes;
- zero TRX and TRC-10 value;
- no memo or custom `permission_id`;
- recent TAPOS fields;
- a short expiration; and
- a `fee_limit` within the Client's local safety policy.

The Client computes `txID = SHA-256(raw_data protobuf bytes)`, signs that digest, and serializes the
complete transaction containing the unchanged `raw_data` and exactly one signature. The separate
Permit2 signature remains the authority for the exact payment amount, settlement proxy, recipient,
nonce, and deadline.

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
10. verify the Permit2 payment authorization, including network, payer, asset, amount, settlement
    proxy, `payTo`, nonce, and deadline;
11. require allowance exactly zero for a new sponsorship, sufficient token balance, and successful
    simulation of the exact signed Approval; and
12. estimate the required Energy and Bandwidth and reject the request when resource or sponsorship
    policy limits are exceeded.

The signed transaction is immutable. The Facilitator MUST broadcast the exact bytes supplied by the
Client and MUST require the node-returned transaction ID to equal the computed `approvalTxID`.

`/verify` is read-only and MUST NOT reserve, delegate, purchase, or broadcast resources. `/settle`
MUST repeat all mutable checks immediately before creating a chain-side effect. Any decoding,
signature, simulation, RPC, or policy error on the sponsored path fails closed.

## Settlement and resource sponsorship

The Facilitator supplies resources only after it holds both the final signed Approval and a valid
Permit2 payment authorization. `(network, approvalTxID)` MUST identify at most one sponsorship
operation so concurrent or retried `/settle` calls cannot create duplicate delegations.

Settlement proceeds in this order:

1. estimate the Approval's Energy and Bandwidth requirements and apply bounded safety margins;
2. reserve sufficient sponsorship capacity under the Facilitator's local policy;
3. submit one unlocked `DelegateResource` transaction for each required resource type;
4. confirm the delegated Energy and Bandwidth are visible and sufficient on the payer;
5. repeat mutable Approval and Payment checks;
6. broadcast the exact payer-signed Approval;
7. confirm successful execution and independently observe the expected allowance;
8. durably record the recovery debt and immediately attempt to prepare, persist, and submit a
   matching `UnDelegateResource` transaction for every successful delegation;
9. continue with the Permit2 payment settlement without waiting for `UnDelegateResource`
   confirmation; and
10. asynchronously confirm or reconcile every original `UnDelegateResource` transaction before
    releasing the reserved Resource Owner capacity.

Energy and Bandwidth are separate TRON resource types and therefore require separate delegation and
reclamation transactions when both are needed. The Facilitator MUST NOT broadcast the Approval until
the required resources are visible and sufficient, and MUST NOT deliberately rely on burning the
payer's TRX as a fallback.

If allowance becomes sufficient before the Approval is broadcast, the Facilitator skips the
Approval. Any resource already delegated MUST enter durable recovery before normal Permit2
settlement continues. The Facilitator MUST immediately attempt to prepare, durably persist, and
submit the matching `UnDelegateResource`. If preparation, persistence of the prepared action,
broadcast, or confirmation cannot complete after the recovery debt is durable, the operation MUST
remain recoverable and a worker MUST continue it asynchronously. Such a recovery failure MUST NOT
turn an otherwise valid payment into a settlement failure. An implementation MUST NOT continue
settlement if it cannot first persist the recovery debt itself.

After any successful delegation, Approval failure, expiration, timeout, caller disconnection, or
settlement failure MUST NOT strand resources on the payer. If no immutable Undelegate action was
persisted, a recovery worker MAY prepare one. Once an action is persisted and its chain result is
unknown, the Facilitator MUST reconcile the original transaction ID before retrying or reclaiming and
MUST NOT create a replacement while the original may still be included. A replacement Undelegate MAY
be prepared only after the original transaction is confirmed failed.

Delegate, Approval, Undelegate, and settlement are separate TRON transactions. Atomic or same-block
execution is not guaranteed. The `transaction` in a successful core `SettleResponse` is the Permit2
payment settlement transaction ID, not a delegation, Approval, or reclamation transaction ID.

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

A valid Approval does not guarantee that the later payment will succeed or reimburse sponsorship
cost. Before delegation, each request MUST be covered by a bounded sponsorship policy, such as funded
tenant credit or a capped platform subsidy. This extension does not charge a user fee inside
`approve`; standard TRC-20 `approve` changes allowance and cannot simultaneously transfer a fee.

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
- [TRON transaction model](https://developers.tron.network/docs/tron-protocol-transaction)
- [TRON confirmation semantics](https://developers.tron.network/docs/confirmation-semantics)
- [TRON signed transaction broadcast](https://developers.tron.network/reference/broadcasthex)
- [TRON `fee_limit`](https://developers.tron.network/docs/set-feelimit)
- [TRON resource model](https://developers.tron.network/docs/resource-model)
- [TRON resource delegation](https://developers.tron.network/docs/delegation)
- [TRON resource reclamation](https://developers.tron.network/docs/resource-reclamation-upon-undelegation)
