# v1.0.0 — TypeScript-Only SDK

Release date: July 2, 2026

## Highlights

The 1.0.0 release is a ground-up rewrite to a **TypeScript-only** pnpm/turbo monorepo. The previous-generation Python + TypeScript SDK moves to `legacy/` for reference. `core` and the EVM mechanism are forks of the [`x402-foundation/x402`](https://github.com/x402-foundation/x402) upstream; the TRON mechanism is in-house. Supported schemes: `exact` (ERC-3009 / Permit2), `upto`, `batch-settlement`, `auth-capture` (EVM), and `exact_gasfree` (TRON).

## Changes

- **Monorepo restructure**: TypeScript-only SDK published as granular `@bankofai/x402-*` packages (`core`, `evm`, `tron`, `fetch`, `express`, `mcp`, `extensions`). The Python SDK and old TS SDK live under `legacy/`.
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
- The Python SDK is no longer published from `main`; it remains under `legacy/` for reference.

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
