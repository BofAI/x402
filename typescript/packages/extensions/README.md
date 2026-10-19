# `@bankofai/x402-tron-extensions`

For 2.1 stable release preparation, see the [migration guide](../../../docs/migrations/tron-2.1.md).

Independent TRON resource sponsorship extension. Both beta packages use `2.1.0-beta.2` and official `@x402/core@2.28.0`; the extension depends on the exact same mechanism version.

```sh
npm install @x402/core@2.28.0 @bankofai/x402-tron@2.1.0-beta.2 @bankofai/x402-tron-extensions@2.1.0-beta.2
```

The mechanism maintains payment schemes, public contracts, and transaction utilities. The extension maintains declarations/schemas, client pre-signing, Approval transaction validation, resource budgets, energy/bandwidth delegation, reclamation, and the coordinator runtime. Basic payments require neither this package nor an Agent Wallet installation.

The project continues on the 2.1 beta line. Published `3.0.0-beta.1` remains a historical experimental version. This migration prerelease requires import changes and explicit extension registration; it does not claim an unchanged-source upgrade from 2.0.

## Client registration

```ts
import { x402Client } from "@x402/core/client";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";
import { createClientTronSigner } from "@bankofai/x402-tron";
import { createTrc20ApprovalResourceSponsoringClientExtension } from "@bankofai/x402-tron-extensions";

const signer = await createClientTronSigner(wallet, { network: "tron:3448148188", rpcUrl });
const client = new x402Client()
  .register("tron:3448148188", new ExactTronScheme(signer))
  .registerExtension(createTrc20ApprovalResourceSponsoringClientExtension(signer));
```

The resource server declares the extension with `declareTrc20ApprovalResourceSponsoringExtension()`. The facilitator registers full capability with `createTrc20ApprovalResourceSponsoringExtension(runtime)`; manually registering only `{ key, runtime }` is insufficient. Create the runtime through `createTrc20ResourceSponsoringRuntime({ network, resourceOwnerSigner, coordinator, allowedAssets, permissionId, ... })` or inject an implementation satisfying the interface. Applications supply Resource Owner signer bridging, providers, and persistent storage.

The client before hook validates declaration version and network. The mechanism creates the final authorization, and the extension uses its actual amount (the actual deposit for batch) to decide whether to pre-sign. When existing allowance or self-funded fallback succeeds, the final hook removes unused resource declarations. Declaration objects are not mutated; reused and concurrent calls remain isolated. Without client extension registration, official Core composition returns `trc20_approval_client_extension_not_registered`. Missing facilitator execution capability returns `sponsor_runtime_unavailable`.

## Migration entrypoints

- Resource factories, coordinator, policies, resource chain adapters, and dedicated types move from the mechanism root to this package root.
- Low-level pre-signing/dedicated validation moves from mechanism internals to public extension entrypoints.
- Payment schemes and compatible wallet factories remain in `@bankofai/x402-tron`.
- Generic RPC configuration and transaction utilities use mechanism `/rpc` and `/transactions`.
- The legacy generic `@bankofai/x402-extensions` package temporarily remains at `packages/legacy/extensions` for callers that have not migrated.

This package exposes its root and `trc20-approval-resource-sponsoring`, plus `client`, `facilitator`, and `resourceService` beneath that subpath. All entrypoints support ESM/CJS.

## Validation and operational boundaries

```sh
pnpm --filter @bankofai/x402-tron build
pnpm --filter @bankofai/x402-tron-extensions build
pnpm --filter @bankofai/x402-tron-extensions test
pnpm --filter @bankofai/x402-tron-extensions test:consumer
```

Independent consumer validation uses both tarballs, official Core, and strict NodeNext (`skipLibCheck: false`) to test real Approval signatures, extension registration, and ordinary payments in ESM/CJS. Isolated tests also cover permissions, budgets, failure reclamation, pending retention, and real Agent Wallet signing.

Production must supply a persistent coordinator and continuously call `runtime.reconcile()` for reconciliation/recovery. The example `InMemoryTrc20SponsoringCoordinator` is for single-process validation only. When resource operations, Approval, or payment outcomes are unknown, reconcile the original txID and retain the corresponding records and resources to avoid duplicate broadcast or sponsorship. Validate service integration, live testnet execution, and persistent recovery separately before production deployment.
