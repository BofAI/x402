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
