# TRC-20 Approval Resource Sponsoring

This Extension enables the first TRON `exact + Permit2` payment without requiring the payer to hold
TRX. The payer signs, but does not broadcast, a canonical TRC-20 Approval. A registered Facilitator
runtime validates the transaction, temporarily delegates the required Energy and Bandwidth,
broadcasts the unchanged Approval, reclaims every delegated resource share, and only then continues
with the Permit2 payment settlement.

The Extension uses the normal x402 request flow. It does not add a Prepare endpoint.

## Resource Server

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

## Client

`@bankofai/x402-tron` handles the Extension automatically. When the Server advertises version `1`
and the allowance is zero, the Client constructs and signs
`approve(canonicalPermit2, MaxUint256)`, serializes the complete signed TRON Transaction protobuf,
and attaches it to the payment payload. The Client does not broadcast the Approval.

When the Extension is absent, the existing self-funded Approval behavior remains unchanged.

## Facilitator

Register a runtime that implements the production resource lifecycle:

```typescript
import {
  createTrc20ApprovalResourceSponsoringExtension,
} from "@bankofai/x402-extensions";
import {
  createTrc20ResourceSponsoringRuntime,
} from "@bankofai/x402-tron/exact/facilitator";

const resourceSponsoringRuntime = await createTrc20ResourceSponsoringRuntime({
  network,
  resourceOwnerWallet,
  coordinator: durableCoordinator,
  allowedAssets: [usdtAddress],
  confirmationMode: "packed",
});

facilitator.registerExtension(
  createTrc20ApprovalResourceSponsoringExtension(resourceSponsoringRuntime),
);
```

The TRON mechanism performs strict protobuf, transaction-signature, Approval-template, and Payment
binding checks before invoking the runtime. `runtime.verify()` must remain read-only.
`runtime.sponsor()` owns durable idempotency, policy admission, resource estimation and reservation,
DelegateResource, resource visibility, immutable Approval broadcast, allowance confirmation,
UnDelegateResource, and unknown-state recovery. It must return success only after Approval allowance
is observable and every successful delegation has entered reclamation.

`durableCoordinator` is an intentional deployment boundary. It must atomically enforce
`(network, approvalTxID)` idempotency, one active resource mutation per payer, Resource Owner
capacity, and sponsorship budget across every Facilitator replica. The SDK exports
`InMemoryTrc20SponsoringCoordinator` only for unit tests and single-process development; production
deployments must not use it.

The managed runtime exposes `reconcile()`. Run it from a recovery worker after startup and on a
schedule so unknown transaction results and recovering capacity converge even when the original
HTTP request or process disappears.

`confirmationMode: "packed"` keeps the multi-transaction Approval path within a short transaction
lifetime, but it is provisional until the block solidifies. Deployments that continue after packed
state must bound that exposure and keep recovery active. `"solidified"` is safer but adds roughly one
TRON finality interval to every chain action and therefore requires a correspondingly longer Client
Approval lifetime.

See [`specs/extensions/trc20_approval_resource_sponsoring.md`](../../../../../specs/extensions/trc20_approval_resource_sponsoring.md)
for normative requirements and residual account-level resource-diversion risk.
