# TRC-20 Approval Resource Sponsoring Review Remediation Design

## Goal

Resolve Will-Guan's six confirmed review findings on PR #84 without changing the core x402 request/response lifecycle or adding implicit multi-transaction Approval behavior. The result must remain scheme-neutral across Exact, Upto, and Batch Settlement and must fail closed before Resource Owner side effects whenever a request cannot safely reach settlement.

## Scope

This change covers:

- payment authorization deadline admission and revalidation;
- sponsored Approval transaction lifetime negotiation;
- recoverable Active Permission validation caching;
- settlement failure response semantics;
- Client signer network binding;
- a shared per-token Approval update policy;
- unit, integration, and Nile regression coverage.

It does not add a database coordinator, a new payment Scheme, a new network, or an implicit `approve(0)` transaction.

## Security invariants

1. A request is rejected before delegation if its payment deadline cannot cover the configured sponsorship saga budget.
2. The payment authorization is checked again immediately before Approval broadcast and immediately before payment settlement.
3. A sponsored Approval must remain broadcastable for the Facilitator's advertised minimum lifetime.
4. A transient permission RPC failure must not permanently disable sponsorship or recovery.
5. A failed settlement response must not identify an unbroadcast Approval as its settlement transaction.
6. A network-bound signer must not read, sign, or broadcast for another network.
7. A partial allowance is updated only when the token has an explicit `direct-overwrite` policy.
8. `zero-first` never adds an implicit reset transaction; it returns `approval_reset_required` when allowance is non-zero but insufficient.
9. `unsupported` never signs or broadcasts an Approval.

## 1. Payment deadline safety

### Saga budget

The Resource Sponsoring Runtime will expose the minimum time required to safely reach settlement. The default is derived from the configured confirmation timeout and the maximum pre-settlement chain actions:

- up to two resource delegation confirmations;
- one Approval confirmation;
- a bounded RPC and settlement-broadcast safety margin.

Operators may configure a larger minimum, but not a value below the derived safe floor.

### Admission and revalidation

The scheme-neutral sponsorship bridge will pass the payment authorization deadline into the Runtime. The Runtime will reject before admission and delegation when the remaining lifetime is below the saga budget.

The existing scheme-specific revalidation callback will run:

- after resources are visible and immediately before Approval broadcast;
- after Approval is observable and immediately before returning control for settlement.

The Scheme will perform one final authorization verification directly before the settlement contract write. Exact, Upto, and Batch Settlement use their existing verification functions with allowance checks disabled where the sponsored Approval has already been established.

Deadline failures retain standard x402 failure semantics and trigger resource recovery when delegation has already happened.

## 2. Approval lifetime negotiation

The Server Extension declaration will include `minimumApprovalLifetimeSeconds`. The value is based on the Facilitator confirmation mode and confirmation timeout and is part of the version 1 Extension capability information.

The Client will validate this value and pass it to `signPermit2Approval`. The stock signer will build the canonical Approval and extend its transaction expiration so its remaining lifetime meets the declared minimum.

The Facilitator will independently parse the signed Approval expiration and reject it before delegation if it does not satisfy its locally configured minimum. Server information is advisory to the Client; Facilitator policy remains authoritative.

Both `packed` and `solidified` are supported. No confirmation mode silently lowers the lifetime requirement.

## 3. Active Permission validation cache

Permission validation will use one shared in-flight Promise for concurrent callers. A fulfilled validation is retained. If validation rejects, the cache is cleared only when it still refers to that same Promise.

This preserves request coalescing, allows recovery after a transient RPC failure, and continues to reject a genuinely invalid permission on every attempt.

## 4. Failure response semantics

`SettleResponse.transaction` represents the payment settlement transaction only. Sponsorship failure therefore always returns an empty transaction string.

The Runtime may retain the deterministic Approval txID internally for idempotency and recovery. An Approval identity is externally exposed only through a specifically named Extension receipt and only when the persisted Approval action is `submitted`, `unknown`, or `confirmed`. The initial remediation does not require adding that optional receipt; omitting it is preferable to exposing an ambiguous transaction.

## 5. Client signer network binding

`ClientTronSigner` will expose an immutable optional `network` capability. `createClientTronSigner` always supplies the exact network used to construct its TronWeb instance.

Before any Approval allowance read or signing call, the shared sponsoring Client helper requires `signer.network === requirements.network`. A missing capability is rejected for sponsored Approval because its RPC network cannot be proven.

Registration helpers register stock network-bound signers on their exact network by default. Explicit network lists must contain only the signer's network. Legacy custom signers without a network capability may continue to serve non-sponsoring flows through existing wildcard registration, but cannot use Resource Sponsoring.

## 6. Shared token Approval policy

A shared module defines:

```text
Trc20ApprovalUpdateStrategy = zero-first | direct-overwrite | unsupported
```

The resolver is keyed by canonical CAIP-2 network and normalized token address. It is consumed by:

- the sponsored Client path before signing;
- the self-funded `ensureAllowance` path before broadcasting;
- Facilitator preflight before resource delegation and again before Approval broadcast.

Policy behavior:

| Current allowance | `zero-first` | `direct-overwrite` | `unsupported` |
| --- | --- | --- | --- |
| sufficient | continue without Approval | continue without Approval | continue without Approval |
| zero | sign/broadcast Max Approval | sign/broadcast Max Approval | reject |
| partial | `approval_reset_required` | sign/broadcast Max Approval | reject |

Known supported tokens default to `zero-first` unless an explicit direct-overwrite policy is configured. Unknown tokens default to `unsupported`. Sponsored and self-funded paths receive the same resolver through stock signer/runtime options.

## API compatibility

- New declaration capability fields are additive within Extension version 1.
- `ClientTronSigner.network` is optional for general compatibility but mandatory at runtime for sponsored Approval.
- Existing `allowedAssets` remains supported; an allowed asset without an explicit strategy receives the conservative `zero-first` policy.
- Existing Exact, Upto, and Batch public Scheme names and payment payloads remain unchanged.
- No hidden `approve(0)` transaction is introduced.

## Error behavior

Stable errors will distinguish:

- insufficient payment deadline;
- insufficient Approval transaction lifetime;
- signer network mismatch or missing network binding;
- unsupported Approval policy;
- required zero-first reset;
- transient RPC failure from genuine permission rejection;
- sponsorship execution failure with an empty settlement transaction.

Diagnostic messages must not include signed transaction bytes, private keys, or wallet secrets.

## Testing

### Focused regression tests

- CR-001: insufficient initial saga budget; expiry before Approval; expiry before settlement.
- CR-002: Client extends Approval lifetime; short Approval is rejected before delegation; packed and solidified configurations.
- CR-003: first permission lookup rejects, second succeeds; concurrent callers share one lookup; invalid permission remains rejected.
- CR-010: delegation/resource-visibility/Approval failures return an empty settlement transaction; only persisted broadcast states may expose Approval identity internally.
- CR-013: Nile-bound signer rejects Mainnet requirements before any read/sign call; default registration uses the exact network.
- CR-020: zero, partial, and sufficient allowance under all three strategies; sponsored and self-funded behavior is identical.

### Scheme matrix

Exact, Upto, and Batch Settlement will each cover:

- packed and solidified admission policy;
- zero, partial, and sufficient allowance;
- deadline failure before side effects;
- successful sponsorship and settlement;
- resource recovery and idempotent retry behavior.

### Final verification

- TRON unit and integration tests;
- Extensions and core integration tests affected by the contract changes;
- TypeScript build, ESLint, Prettier, and `git diff --check`;
- Nile packed-mode on-chain regression for Exact, Upto, and Batch Settlement;
- a solidified Nile path if the configured Approval lifetime and testnet finality window permit deterministic completion.

## Acceptance criteria

1. All six review findings have a failing regression test that passes after the implementation.
2. No Resource Owner delegation occurs for a request rejected by initial deadline, Approval lifetime, network, or token policy admission.
3. Every settlement failure returns `transaction: ""` unless a real payment settlement transaction was submitted.
4. Permission validation recovers after a transient RPC failure without process restart.
5. Exact, Upto, and Batch continue to pass Nile packed-mode validation with zero residual delegation.
6. The complete relevant offline test and quality suite passes.
