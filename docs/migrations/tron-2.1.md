# TRON SDK 2.1 Migration Guide

Use this guide to migrate application imports, wallet integrations, and resource sponsorship to official Core.

## Installation and compatibility

```sh
# Install the matching mechanism and optional extension versions
npm install @x402/core@2.28.0 @bankofai/x402-tron@2.1.0-beta.3
# Required only for resource sponsorship
npm install @bankofai/x402-tron-extensions@2.1.0-beta.3
# Select official HTTP / MCP integrations for the application role
npm install @x402/fetch@2.28.0 @x402/express@2.28.0
```

Upgrading from 2.0 requires source migration. The protocol remains x402 v2, with `exact`, `upto`, `batch-settlement`, `exact_gasfree`, and the existing wallet factories. This does not make legacy Core instances interchangeable with the new mechanisms. Use official Core 2.28.0 throughout the payment call chain and upgrade HTTP/MCP adapters together. `@x402/core` is an exact peer dependency of the mechanism package.

The extension depends on the exact same mechanism version. Upgrade both TRON packages together; avoid mixing beta and stable versions. Ordinary payments require only the mechanism and official Core, without the resource extension or an Agent Wallet runtime dependency.

The local EVM mechanism package is retired. Use official `@x402/evm@2.28.0` for EVM and its public signer adapters; the retired `@bankofai/x402-evm/adapters/agent-wallet` factory path is not available from the official package. Follow the upstream EVM examples.

Generic extensions such as Bazaar, Sign-in-with-x, and EVM gas sponsorship use official `@x402/extensions@2.28.0` directly. The repository no longer contains legacy v1 packages or `@bankofai/x402-extensions`. Use published upstream packages if legacy APIs are still needed.

## Import changes

| 2.0 location | 2.1 location |
| --- | --- |
| `@bankofai/x402-core/client` | `@x402/core/client` |
| `@bankofai/x402-core/server`, `facilitator`, `types`, `http` | Corresponding `@x402/core` subpaths |
| `x402Client` from `@bankofai/x402-fetch` | `@x402/core/client` |
| `wrapFetchWithPayment` from `@bankofai/x402-fetch` | `@x402/fetch` |
| `@bankofai/x402-express` / `x402-mcp` | `@x402/express` / `@x402/mcp`; import Core classes from their role subpaths |
| Resource runtime, coordinator, policies, chain adapters, and types at the mechanism root | `@bankofai/x402-tron-extensions` |
| TRON declarations, schemas, and extension factories in the legacy generic extension package | `@bankofai/x402-tron-extensions` |
| Resource Approval pre-signing and dedicated validation inside the mechanism | Public extension package entrypoints |
| Legacy Core TRON logging configuration | `setLogger`, `noopLogger` from `@bankofai/x402-tron` |

Continue importing wallet factories, structural wallet types, and payment schemes from the mechanism package. Import public RPC and transaction utilities from `@bankofai/x402-tron/rpc` and `@bankofai/x402-tron/transactions`. `/exact/extensions` retains the public contract between the mechanism and extension; it does not include the resource execution runtime.

The extension exposes its root, `/trc20-approval-resource-sponsoring`, and the `/client`, `/facilitator`, `/resourceService` subpaths under that entrypoint, all supporting ESM and CommonJS. Do not import private `src/` or `dist/` paths.

Legacy Core's `createResourceServer` and `createFacilitator` are repository-specific logging wrappers. Replace them with official `new x402ResourceServer(facilitatorClient)` and `new x402Facilitator()`; explicitly register lifecycle hooks where logging is needed.

## Ordinary payments and wallets

```ts
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientTronSigner, TRON_NILE } from "@bankofai/x402-tron";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";

const signer = await createClientTronSigner(wallet, { network: TRON_NILE, rpcUrl });
const client = new x402Client().register(TRON_NILE, new ExactTronScheme(signer));
const paidFetch = wrapFetchWithPayment(fetch, client);
```

The application owns `wallet`, which continues to satisfy the `ClientTronWallet` / `FacilitatorTronWallet` structural contract. Factories remain asynchronous, taking the wallet first and network/RPC configuration second. Signing services can implement the signer contract directly. Agent Wallet 3 `{ family: "tron", transaction }` signing results are unwrapped; legacy signed transaction objects, JSON strings, and raw signatures remain supported. EVM artifacts and malformed TRON transaction envelopes are rejected.

A signer with only TIP-712 signing can serve only payment paths whose signing requirements it meets. Balance/allowance queries require `readContract`; automatic Approval also needs transaction signing. Applications must arrange allowance in advance when that capability is unavailable. A successful signature does not establish on-chain allowance.

Network output continues to use decimal CAIP-2: mainnet `tron:728126428`, Nile `tron:3448148188`, and Shasta `tron:2494104990`. Legacy hexadecimal identifiers remain accepted input aliases.

## Register resource sponsorship for all three roles

After registering ordinary payments, explicitly register the client pre-signing extension:

```ts
import { createTrc20ApprovalResourceSponsoringClientExtension } from "@bankofai/x402-tron-extensions";

client.registerExtension(createTrc20ApprovalResourceSponsoringClientExtension(signer));
```

On resource server routes requiring sponsorship, set `extensions: declareTrc20ApprovalResourceSponsoringExtension()`, importing the declaration factory from the extension package. On the facilitator, construct the runtime with `createTrc20ResourceSponsoringRuntime(...)`, then register the full capability with `facilitator.registerExtension(createTrc20ApprovalResourceSponsoringExtension(runtime))`. Manually registering `{ key, runtime }` does not replace these factories.

Applications remain responsible for the Resource Owner wallet, permission ID, allowed assets, resource capacity, and budget. An unregistered client extension returns `trc20_approval_client_extension_not_registered`; missing facilitator execution capability returns `sponsor_runtime_unavailable`. Ordinary payments do not require these extensions.

`InMemoryTrc20SponsoringCoordinator` is for development validation only. Production deployments must supply a persistent coordinator, continuously run `runtime.reconcile()`, and recover unfinished delegation, payment, and reclamation tasks after restarts.

## Preflight, spend caps, and pending settlement

- Failed or malformed required upto allowance/balance RPC reads return `chain_read_failed` without broadcasting settlement. Repair RPC access before retrying preflight.
- Official Core's `maxAmountPerPayment` is checked against the actual authorized amount: the current deposit for batch, and `value + maxFee` for GasFree. A default batch deposit above the cap is rejected. Configure an appropriate `depositStrategy` or explicitly adjust the cap; the cumulative voucher amount is not the new deposit amount.
- Preserve 2.0 `settlement_pending` semantics: when broadcast succeeds but the receipt is unknown, save and reconcile the original transaction ID. Do not reauthorize or interpret a timeout as proof that no funds were spent. Retain records and resources for recovery when resource operations have unknown outcomes as well.
- HTTP timeouts are application integration settings. After switching to official HTTP/MCP packages, recheck request timeouts, pending retries, and resource delivery policies. SDK validation does not establish that these external service settings have been migrated.

## Facilitator pending storage

Official Core automatically retries `settlement_pending` once when a txID is present. The 2.1 facilitator saves the original transaction before waiting for its receipt. A retry with the same payment and effective settlement requirements resumes that transaction, skipping repeated preflight, sponsorship, and broadcast. Batch deposit/refund/settle recovery restores original amount and state snapshots. When GasFree has a relayer trace but no on-chain hash, it preserves `extra.gasfreeTraceId`; later calls query the same task without submitting again. Pending results without a hash do not trigger Core's automatic retry.

The default `InMemoryTronPendingSettlementStore` covers one process only; unconfirmed records do not expire automatically. Production restart recovery or multiple replicas require a persistent, shared `TronPendingSettlementStore`. Exported from each `/facilitator` entrypoint, the interface provides `get`, `set`, `delete`, and `withLock`. Records contain serializable original txID / relayer trace data and required snapshots. `withLock` must hold an exclusive lock for the same key across all replicas throughout the callback, including receipt waits. Leases must last or be renewed until the callback finishes.

Inject the implementation through the constructor's `pendingSettlementStore` option: the second argument for exact / upto, the third for GasFree, and the third after signer and optional authorizerSigner for batch. The exact and GasFree registration factories accept the same option. A failed storage read rejects before broadcast. A failed save after broadcast returns `settlement_store_unavailable`, preserving the known txID / trace. Applications should reconcile the original task before resubmitting after storage failure or process exit. The resource coordinator and pending transaction store maintain separate recovery records; production needs both.

## Upgrade validation

First validate strict TypeScript compilation, ESM/CJS loading, and registration of all three roles in an isolated environment, then exercise the required payment paths. Repository CI includes independent consumption tests using both real tarballs. Mechanism and extension versions must match, and packed extension dependencies must not retain `workspace:` references. Validate application timeouts, live-chain flows, and persistent recovery separately before production deployment.
