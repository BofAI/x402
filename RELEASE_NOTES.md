# v0.6.0-beta.1 — TypeScript Facilitator Settlement Parity

Release date: May 13, 2026

## Highlights

This beta completes the TypeScript facilitator settlement paths needed for QA. TypeScript now matches Python's signer-injected facilitator model and can verify and settle `exact`, `exact_permit`, and `exact_gasfree` payments.

## Changes

- **Facilitator signers (TS)**: `FacilitatorSigner`, `EvmFacilitatorSigner`, and `TronFacilitatorSigner` verify typed data, write contracts, check balances, and poll receipts.
- **`exact` facilitator (TS)**: verifies ERC-3009/TIP-712 transfer authorizations and settles with `transferWithAuthorization`.
- **`exact_permit` facilitator (TS)**: verifies `PaymentPermit` signatures and settles with `PaymentPermit.permitTransferFrom`.
- **`exact_gasfree` facilitator (TS)**: verifies GasFree TIP-712 permits, submits through the GasFree API proxy, and returns the resulting TRON transaction hash.
- **Public exports**: facilitator signer APIs and updated mechanism constructors are exported from the TypeScript SDK.
- **Compatibility with beta.0**: beta.0 introduced the TS facilitator client, engine, middleware, and fetch wrapper. beta.1 completes the missing settlement implementation.

## Verification

- TypeScript build passed.
- TypeScript test suite passed: 19 files / 158 tests.
- npm tarball inspected after publish: `ExactGasFreeFacilitatorMechanism(signer, options)` and `ExactEvmFacilitatorMechanism(signer, options?)` are present in the published declarations.
- x402-demo TypeScript smoke passed against `@bankofai/x402@0.6.0-beta.1`.
- TRON Nile on-chain smoke transactions:
  - `exact_gasfree`: `97ec5443edaf4bbe8633ee8fc0dc923c4809df4f95625718d1f33e499cf2313d`
  - `exact_permit`: `6aeccd9ff25e9c241b08082ea11149177597ae041daf6aa5dd6c0b7c0634d20a`

## Released

- npm: `@bankofai/x402@0.6.0-beta.1` (`beta` dist-tag)
- PyPI remains: `bankofai-x402==0.6.0b0`

## Compatibility

- TypeScript facilitator mechanisms now require a facilitator signer instance.
- Hono and Express are optional peer deps. Apps that don't import the framework adapters do not need to install them.
- Minimum Node.js 20 (unchanged from 0.5.9). Python 3.11+.
