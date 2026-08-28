# v1.1.0 — Payment Flow and Wallet Compatibility

Release date: August 25, 2026

## Highlights

Version 1.1.0 aligns all 11 public TypeScript packages and brings the BankofAI SDK up to date with the latest upstream TypeScript payment orchestration work. It adds explicit authorization, upfront, and escrow payment flows; safer client payment policies; broader EVM wallet support; more precise EVM and TRON settlement handling; and hardened HTTP and MCP integrations.

## Upgrade Notes

- Upgrade the complete `@bankofai/x402-*` package set together to `1.1.0`; internal package dependencies use the `~1.1.0` release line.
- Custom money parsers now receive a decimal string rather than a JavaScript number. Use `Number(amount)` only for threshold comparisons; pass the string directly to token conversion helpers to preserve precision.
- TRON integrations should use canonical CAIP-2 identifiers: `tron:0xcd8690dc` (Nile), `tron:0x94a9059e` (Shasta), and `tron:0x2b6653dc` (mainnet).
- Facilitators enabling ERC-6492 deployment must configure `eip6492AllowedFactories`; an omitted or empty allowlist rejects counterfactual factory calls.
- The hosted/self-hosted `x402-facilitator` remains wire-compatible with v2 client and server flows. Upgrade its `@bankofai/x402-*` dependencies to `1.1.0` after publishing this release so runtime behavior and type declarations stay aligned.

## Changes

- **Payment-flow orchestration**: server schemes can declare supported flows per asset-transfer method. Core consistently schedules verification and settlement before or after the resource handler for `authorization`, `upfront`, and `escrow` flows.
- **Backward-compatible custom schemes**: v1.0 `SchemeNetworkServer` implementations may omit `defaultAssetTransferMethod` and `paymentFlows`; core treats them as legacy authorization flows.
- **Client safety controls**: clients gain payment-selection policies, spend caps, transaction limits, and lifecycle hooks for observing and rejecting payment creation.
- **Facilitator reliability**: `HTTPFacilitatorClient` validates responses, normalizes nullable cross-SDK fields, retries rate-limited `/supported` requests, surfaces typed timeout errors, and now defaults to a 90-second request timeout for receipt-backed settlement.
- **EVM wallet compatibility**: verification and settlement support EOAs, deployed smart accounts, ERC-7702 delegation, and allowlisted ERC-6492 counterfactual deployment. Receipt validation confirms the expected transfer instead of trusting transaction status alone.
- **EVM assets and settlement**: BSC default assets are restored, Permit2 handling is tightened, and settlement responses distinguish pending receipts from confirmed failures.
- **TRON precision and token selection**: decimal prices retain their original string precision, token-symbol prices select the requested asset, and default asset conversion is consistent across `exact`, `upto`, and batch settlement.
- **Extensions**: builder-code supports multiple service codes, SIWX validation and hooks are expanded, and dynamic extension fields such as nonces and timestamps no longer cause false echo mismatches.
- **HTTP middleware hardening**: Express, Fastify, Hono, and Next.js normalize encoded paths and line terminators consistently so alternate path encodings cannot bypass protected routes.
- **MCP interoperability**: MCP clients accept optional wire fields encoded as either `null` or omitted and preserve existing response metadata while adding payment metadata.

## Verification

- `pnpm build:release`
- `pnpm test` (34 workspace tasks)
- `pnpm lint:check`
- `pnpm format:check`
- npm package tarballs inspected to confirm versions and rewritten internal dependency ranges

## Release Artifacts

- `@bankofai/x402-core@1.1.0`
- `@bankofai/x402-extensions@1.1.0`
- `@bankofai/x402-mcp@1.1.0`
- `@bankofai/x402-evm@1.1.0`
- `@bankofai/x402-tron@1.1.0`
- `@bankofai/x402-axios@1.1.0`
- `@bankofai/x402-express@1.1.0`
- `@bankofai/x402-fastify@1.1.0`
- `@bankofai/x402-fetch@1.1.0`
- `@bankofai/x402-hono@1.1.0`
- `@bankofai/x402-next@1.1.0`

## Credits

Release integration and BankofAI compatibility work by [@roger-gan](https://github.com/roger-gan) in [PR #83](https://github.com/BofAI/x402/pull/83), building on the upstream [x402 Foundation](https://github.com/x402-foundation/x402) TypeScript SDK.

# v1.0.0 — TypeScript-Only SDK

Release date: July 2, 2026

## Highlights

The 1.0.0 release is a ground-up rewrite to a **TypeScript-only** pnpm/turbo monorepo. At release time, the previous-generation Python + TypeScript SDK moved to a root `legacy/` archive, which has since been removed. `core` and the EVM mechanism are forks of the [`x402-foundation/x402`](https://github.com/x402-foundation/x402) upstream; the TRON mechanism is in-house. Supported schemes: `exact` (ERC-3009 / Permit2), `upto`, `batch-settlement`, `auth-capture` (EVM), and `exact_gasfree` (TRON).

## Changes

- **Monorepo restructure**: TypeScript-only SDK published as granular `@bankofai/x402-*` packages (`core`, `evm`, `tron`, `fetch`, `express`, `mcp`, `extensions`). The Python SDK and old TS SDK were archived under root `legacy/` for this release and removed later.
- **BSC USDT support**: express server `exact` example now advertises BSC testnet USDT (`0x337610d2…`, 18 dec, permit2) alongside DHLU and USDC. Mainnet USDT is registered in the default-asset registry (`eip155:56`, permit2).
- **Token symbol resolution**: fetch client `TOKEN_ADDRESSES` now indexes by chain family so the same symbol (e.g. `USDT`) resolves to the correct contract per network (BSC testnet vs TRON Nile).
- **TRON settle receipt accuracy**: facilitator transaction polling switched from `trx.getTransaction` (fullNode preconfirm, which could transiently read `REVERT` on mainnet and cause false settle failures) to the fullNode `gettransactioninfobyid` endpoint, waiting for `blockNumber` + `receipt.result`. ~3-6s latency with authoritative results — mirrors tronpy's `get_transaction_info`.
- **Documentation**: README aligned with the TypeScript-only SDK; `.env-exact.example` updated to list USDT among EVM token options.

## Verification

- BSC testnet USDT `exact` payment end-to-end: settle tx `0x477f00845964271d53cc36028756fa4ce260674ff6b103e6a86a47f2e79a9edd` (SUCCESS).
- TRON mainnet USDT `exact` payment on-chain success confirmed (tx `604f51c8…0acc`, `contractRet: SUCCESS`); receipt polling fix verified against this tx.

## Release Artifacts

- npm packages: `@bankofai/x402-core@1.0.0`, `@bankofai/x402-evm@1.0.0`, `@bankofai/x402-tron@1.0.0`, `@bankofai/x402-fetch@1.0.0`, `@bankofai/x402-express@1.0.0`, `@bankofai/x402-mcp@1.0.0`, `@bankofai/x402-extensions@1.0.0`.

## Compatibility

- TypeScript-only; Node.js >= 20, pnpm >= 11.
- The Python SDK is no longer published from `main`; its temporary root `legacy/` archive has since been removed.

# v0.6.1 — TRON exact_permit Wallet CLI Fix

Release date: June 24, 2026

## Changes

- **Python TRON facilitator signer**: restored wallet CLI / `agent-wallet` transaction signing for contract writes while keeping active permission support through `TRON_PERMISSION_ID` (default `2`).
- **`exact_permit` settlement**: facilitator settlement no longer requires `TRON_FACILITATOR_PRIVATE_KEY` / `TRON_PRIVATE_KEY` when the active wallet is already available through wallet CLI.
- **Version alignment**: Python package metadata, runtime `bankofai.x402.__version__`, and TypeScript package metadata are aligned to `0.6.1`.

## Verification

- Python signer regression tests passed for TRON facilitator contract writes and existing client signer wallet payload behavior.

# v0.6.0 — TypeScript / Python Facilitator Parity

Release date: May 13, 2026

## Highlights

This release completes the 0.6.0 TypeScript parity work against the Python SDK. TypeScript now has the facilitator client, facilitator engine, server middleware, fetch wrapper, signer-injected facilitator mechanisms, and verify/settle support for `exact`, `exact_permit`, and `exact_gasfree`.

## Changes

- **Facilitator client (TS)**: remote facilitator calls for `/supported`, `/fee/quote`, `/verify`, and `/settle`.
- **Facilitator engine (TS)**: mechanism routing by `(network, scheme)` with normalized settlement responses.
- **Server middleware (TS)**: Hono and Express adapters backed by a shared framework-neutral request processor.
- **Fetch wrapper (TS)**: full HTTP verb support, injectable `fetch`, policy selection, and `X-PAYMENT-RESPONSE` parsing.
- **Facilitator signers (TS)**: `FacilitatorSigner`, `EvmFacilitatorSigner`, and `TronFacilitatorSigner` verify typed data, write contracts, check balances, and poll receipts.
- **`exact` facilitator (TS)**: verifies ERC-3009/TIP-712 transfer authorizations and settles with `transferWithAuthorization`.
- **`exact_permit` facilitator (TS)**: verifies `PaymentPermit` signatures and settles with `PaymentPermit.permitTransferFrom`.
- **`exact_gasfree` facilitator (TS)**: verifies GasFree TIP-712 permits, submits through the GasFree API proxy, and returns the resulting TRON transaction hash.
- **Public exports**: facilitator client, engine, middleware, fetch wrapper, signer APIs, protocol constants, and updated mechanism constructors are exported from the TypeScript SDK.
- **Python release alignment**: Python package metadata is aligned to `0.6.0`.

## Verification

- TypeScript build passed.
- TypeScript test suite passed: 19 files / 158 tests.
- npm release tarball inspected before final release prep: `ExactGasFreeFacilitatorMechanism(signer, options)` and `ExactEvmFacilitatorMechanism(signer, options?)` are present in the declarations.
- x402-demo TypeScript smoke passed against the 0.6.0 release candidate.
- TRON Nile on-chain smoke transactions:
  - `exact_gasfree`: `97ec5443edaf4bbe8633ee8fc0dc923c4809df4f95625718d1f33e499cf2313d`
  - `exact_permit`: `ae91d7e02fea6855f22ffcb945dbf280ff526f72ef156f997e22d4cc8c053e80`

## Release Artifacts

- npm package version prepared: `@bankofai/x402@0.6.0`
- Python package version prepared: `bankofai-x402==0.6.0`

## Compatibility

- TypeScript facilitator mechanisms now require a facilitator signer instance.
- Hono and Express are optional peer deps. Apps that don't import the framework adapters do not need to install them.
- Minimum Node.js 20 (unchanged from 0.5.9). Python 3.11+.
