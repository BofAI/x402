# TRC-20 Approval Resource Sponsoring

Part of [`@bankofai/x402-extensions`](../README.md). **Import from the package root:**
`import { ... } from "@bankofai/x402-extensions"` (this module is not a separate npm export
subpath).

This Extension enables the first supported TRON Permit2 operation without requiring the payer to
hold TRX. Version 1 supports `exact`, `upto`, and the Permit2 deposit/top-up path of
`batch-settlement`. The payer signs, but does not broadcast, a canonical TRC-20 Approval. A
registered Facilitator runtime validates the transaction, temporarily delegates the required Energy
and Bandwidth, broadcasts the unchanged Approval, durably submits reclamation for every delegated
resource share, and then continues with the selected operation while reclamation confirmation runs
asynchronously.

The Extension uses the normal x402 request flow. It does not add a Prepare endpoint.

## End-to-end flow

1. **Resource Server** advertises `trc20ApprovalResourceSponsoring` in
   `PaymentRequired.extensions` for a supported TRON Permit2 route.
2. **Client** builds the normal Permit2 payment payload. When allowance is insufficient and the
   Server advertised the Extension, the TRON `exact`, `upto`, or Permit2 batch-deposit Client applies
   its token Approval policy and, when permitted, automatically attaches a serialized, signed
   `approve(canonicalPermit2, MaxUint256)` transaction. The Client does not broadcast it.
3. **Facilitator** registers `createTrc20ApprovalResourceSponsoringExtension(runtime)`. During the
   normal `/verify` and `/settle` flow it validates the signed Approval, temporarily makes the
   required resources available, broadcasts the unchanged transaction, persists and submits the
   matching Undelegates, and continues with Permit2 settlement without waiting for their confirmation.

There is no additional Server-to-Facilitator endpoint. The public x402 interaction remains
`402 Payment Required -> PAYMENT-SIGNATURE -> /verify -> /settle`.

## Resource server

```typescript
import { declareTrc20ApprovalResourceSponsoringExtension } from "@bankofai/x402-extensions";

const route = {
  price: {
    amount: "1000000",
    asset: "T...",
    extra: { assetTransferMethod: "permit2" },
  },
  extensions: {
    ...declareTrc20ApprovalResourceSponsoringExtension(),
  },
};
```

The version 1 Client SDK constructs an Approval with at least 600 seconds of remaining lifetime. The
Facilitator independently enforces its local saga window and rejects a shorter transaction before
delegating resources. The route must use `assetTransferMethod: "permit2"`. Batch use is limited to
deposit/top-up payloads; voucher, claim, settle, refund, and EIP-3009 deposit paths do not use this
Extension. Declaring the Extension is the only additional Resource Server integration.

## Client

**You do not manually add this Extension** when using the supported TRON Client schemes.
`@bankofai/x402-tron` handles it automatically. When the Server advertises version `1`, the selected
path uses Permit2, and allowance is zero, the Client constructs and signs
`approve(canonicalPermit2, MaxUint256)`, serializes the complete signed TRON Transaction protobuf,
and attaches it to the payment payload. The Client does not broadcast the Approval.

Use `createClientTronSigner(...)` for the standard signer setup. Custom signers must expose
`readContract`, `signPermit2Approval`, an exact `network` binding, and a compatible Approval policy.
Known supported assets default to the conservative `zero-first` strategy: a non-zero insufficient
allowance is rejected with `approval_reset_required`. Operators may explicitly configure
`direct-overwrite` only for tokens known to support it; unknown assets are rejected.

When the Extension is absent, the existing self-funded Approval behavior remains unchanged.

## Facilitator

### Typical stack (`@bankofai/x402-core` + `@bankofai/x402-tron`)

Register the normal TRON scheme and a runtime that implements the resource lifecycle:

```typescript
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import {
  createTrc20ApprovalResourceSponsoringExtension,
} from "@bankofai/x402-extensions";
import {
  createTrc20ResourceSponsoringRuntime,
} from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";

const resourceSponsoringRuntime = await createTrc20ResourceSponsoringRuntime({
  network,
  resourceOwnerSigner,
  coordinator: durableCoordinator,
  allowedAssets: [usdtAddress],
  permissionId: 2,
  confirmationMode: "packed",
  approvalStrategies: {
    // Optional and token-specific. Omit to keep the conservative zero-first policy.
    // [usdtAddress]: "direct-overwrite",
  },
});

const facilitator = new x402Facilitator()
  .register(network, new ExactTronScheme(facilitatorSigner))
  .registerExtension(
    createTrc20ApprovalResourceSponsoringExtension(resourceSponsoringRuntime),
  );
```

The Resource Owner must have Stake 2.0 resource capacity and a non-zero Active Permission that
authorizes Delegate/Undelegate. `resourceOwnerSigner` receives an exact, network-bound resource
intent plus the locally validated transaction so a remote wallet or HSM can enforce the same policy.
The payer must be an activated EOA and the asset must be in the Facilitator allowlist. The Client and
Facilitator apply the same token-specific Approval update strategy before sponsorship.

### Production runtime requirements

The TRON mechanism performs strict protobuf, transaction-signature, Approval-template, and Payment
binding checks before invoking the runtime. `runtime.verify()` must remain read-only.
`runtime.sponsor()` owns durable idempotency, policy admission, resource estimation and reservation,
DelegateResource, resource visibility, pre-broadcast Scheme revalidation, immutable Approval
broadcast, allowance confirmation, durable UnDelegateResource submission, and unknown-state
recovery. It returns success after Approval allowance is observable and every successful delegation
has durable recovery debt; it does not wait for UnDelegateResource confirmation.

`durableCoordinator` is an intentional deployment boundary. It must atomically enforce
`(network, approvalTxID)` idempotency, one active resource mutation per payer, Resource Owner
capacity, and sponsorship budget across every Facilitator replica. It must load an existing
operation before allowance shortcuts and return every non-terminal state from `listRecoverable`.
The SDK exports
`InMemoryTrc20SponsoringCoordinator` only for unit tests and single-process development; production
deployments must not use it.

The managed runtime exposes `reconcile()`. Run it from a recovery worker immediately after startup
and on a schedule so prepared, submitted, unknown, and every non-terminal lifecycle state converge
even when the original HTTP request or process disappears. Recovery confirmation failures remain
resource debt and do not retroactively fail a successful Permit2 payment.

Coordinator failures are fail-closed. If admission or a state transition cannot be persisted, the
runtime does not execute the subsequent chain action. If `listRecoverable` fails, `reconcile()`
rejects so the worker can alert and retry; a failure while reconciling one durable operation leaves
that operation non-terminal for a later pass. Operators must monitor both the worker and the age of
recovery debt. A temporary storage outage is recoverable after the coordinator returns. Permanent
loss or corruption of coordinator data cannot be repaired from memory: operators must rebuild the
receiver set from TRON's delegated-resource account index, compare it with Resource Owner activity,
and submit validated UnDelegateResource transactions before restoring capacity. The SDK does not
provide a production database implementation because storage and replica coordination are a
deployment concern, but losing the durable coordinator is never treated as a clean state.

`confirmationMode: "packed"` keeps the multi-transaction Approval path within a short transaction
lifetime, but it is provisional until the block solidifies. Deployments that continue after packed
state must bound that exposure and keep recovery active. `"solidified"` is safer but adds roughly one
TRON finality interval to every chain action; the fixed 600-second Client Approval lifetime leaves
additional room for that mode and for normal request forwarding or RPC delay.

### Settlement latency

The sponsored path is intentionally longer than a payment whose Permit2 allowance already exists.
With `confirmationMode: "packed"`, a Nile confirmation is commonly observed in roughly 3–6 seconds.
One delegated resource therefore adds about 6–15 seconds for DelegateResource plus Approval; when
both Energy and Bandwidth are needed, two sequential delegations plus Approval commonly add about
9–20 seconds, including ordinary RPC and persistence overhead. Compared with a self-funded first
payment that already waits for Approval, the incremental cost is normally the delegation
confirmation time. UnDelegateResource submission is recorded and started before success is returned,
but its confirmation is asynchronous and does not extend the settlement response.

These figures are operational expectations, not protocol guarantees. With the default 90-second
confirmation timeout, the synchronous sponsorship ceiling is two DelegateResource confirmations
plus one Approval confirmation and the 15-second settlement margin: 285 seconds. The final Permit2
settlement receipt has its own 90-second timeout, so the full HTTP request can approach 375 seconds
in the timeout case. Admission rejects payment authorizations whose remaining deadline cannot cover
the configured sponsorship window. The resource server, facilitator, and outer gateway HTTP
timeouts must therefore be configured above this computed ceiling; the core client's 120-second
default only covers the ordinary single-transaction TRON settlement path. `"solidified"` adds
approximately one finality interval to each confirmed action and must be sized separately.

The runtime rejects a payment authorization whose remaining deadline cannot cover delegation,
Approval confirmation, and the settlement safety margin. It revalidates the selected Scheme before
Approval broadcast and again after Approval confirmation; Exact, Upto, and Batch Settlement perform
their final validation immediately before the payment transaction is submitted. Sponsorship
failures return an empty core `SettleResponse.transaction`; that field is reserved for a submitted
payment settlement transaction, not a prepared Approval ID.

## ERC-20 alignment

The public Extension Contract intentionally matches `erc20ApprovalGasSponsoring`: the same package
layout, declaration helper, automatic Client enrichment, `signedTransaction` payload field,
Facilitator factory, and standard `/verify` and `/settle` lifecycle are used. TRON adds a resource
runtime because Energy and Bandwidth are account-level, recoverable resources; that execution layer
does not change the Resource Server or Client protocol.

## Related exports

See [`index.ts`](./index.ts) for `TRC20_APPROVAL_RESOURCE_SPONSORING`,
`declareTrc20ApprovalResourceSponsoringExtension`,
`createTrc20ApprovalResourceSponsoringExtension`, validation helpers, and types.

See [`specs/extensions/trc20_approval_resource_sponsoring.md`](../../../../../specs/extensions/trc20_approval_resource_sponsoring.md)
for normative requirements and residual account-level resource-diversion risk.
