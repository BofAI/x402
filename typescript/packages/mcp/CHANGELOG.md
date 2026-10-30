# @bankofai/x402-mcp Changelog

## 1.1.1

### Patch Changes

- [#112](https://github.com/BofAI/x402/pull/112) [`2d821f0`](https://github.com/BofAI/x402/commit/2d821f01b0e7714cfe14ce109066395b61eb2e99) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Use native Zod 4.6.6 or newer to fix GHSA-mrhx-c7xc-m3w5. Oversized resource tag arrays now stop before element validation instead of accumulating per-element errors. Update the MCP transport's direct Zod dependency to the same safe range. Align V1 and V2 payment-option arrays with official Core's 1,024-entry maximum, so oversized `accepts` arrays also stop before validating individual entries.

  The core `/schemas` export now exposes native Zod 4 schemas, `z`, and safe-parse result types. Consumers that compose schemas must use Zod 4 and use `error.issues` instead of the removed Zod 3 `error.errors` alias. Normal JSON payment payloads, extensible records, and nullable optional metadata remain supported. Do not import `zod/v3` as a compatibility workaround: that entry still uses the affected collection parser.

- [#112](https://github.com/BofAI/x402/pull/112) [`79ceff8`](https://github.com/BofAI/x402/commit/79ceff860ebd52ad9f5a0e4a82706863f064f90d) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Adopt the official x402 2.29.0 security release using native Zod >=4.6.6. Update official extensions in the HTTP integrations and align the MCP SDK with the official transport's 1.32.0 minimum. Example dependencies and strict packed consumer checks now use the same official versions.

  TRON and TRON resource extensions now require official `@x402/core@2.29.0` as a peer instead of 2.28.0. Upgrade that peer alongside these packages. The official Core `/schemas` export uses Zod 4; applications composing those schemas must also use native Zod 4. Oversized `accepts` arrays are limited to 1,024 entries by the official release.

- Updated dependencies [[`2d821f0`](https://github.com/BofAI/x402/commit/2d821f01b0e7714cfe14ce109066395b61eb2e99)]:
  - @bankofai/x402-core@2.0.0

## 1.1.0

### Minor Changes

- Release the aligned v1.1.0 TypeScript SDK package set. This release adds explicit payment-flow orchestration, client spend controls and hooks, improved remote facilitator timeout and error handling, EVM smart-wallet and settlement receipt support, TRON money parsing and canonical network identifiers, cross-SDK MCP normalization, extension improvements, and HTTP middleware hardening.

### Patch Changes

- Updated dependencies []:
  - @bankofai/x402-core@1.1.0

## 2.15.0

### Minor Changes

- Updated dependencies [bfa580e](https://github.com/x402-foundation/x402/commit/bfa580e)
- Updated dependencies [3a60816](https://github.com/x402-foundation/x402/commit/3a60816)
- Updated dependencies [7539e93](https://github.com/x402-foundation/x402/commit/7539e93)
  - @bankofai/x402-core@2.15.0

## 2.14.0

### Minor Changes

- 4a5fd5b: Preserve existing MCP response metadata when adding x402 payment metadata.
- be788e0: Thread Bazaar service metadata from HTTP `RouteConfig` and MCP `PaymentWrapperConfig` into `PaymentRequired.resource`, and extend bazaar facilitator discovery/catalog types so verified payments persist description, MIME type, service metadata, and echoed extension payloads.
- Updated dependencies [be788e0]
- Updated dependencies [0af31dd]
  - @bankofai/x402-core@2.14.0

## 2.13.0

### Minor Changes

- 5fca9f3: Implemented missing hook primitives needed for batch-settlement aligning with http transport
- Updated dependencies [ad08a9a]
- Updated dependencies [5fca9f3]
- Updated dependencies [95f2094]
- Updated dependencies [49ea054]
  - @bankofai/x402-core@2.13.0

## 2.12.0

### Minor Changes

- ee7c156: chore: tighten viem dependency floor to ^2.48.11

  Raises the viem floor in every `@bankofai/x402-*` package.json that lists viem as a direct dep so future `pnpm install` re-resolutions cannot regress below this version. Fixes the incomplete tightening from #2013.

- Updated dependencies [608034f]
- Updated dependencies [d235050]
- Updated dependencies [45d7d19]
  - @bankofai/x402-core@2.12.0

## 2.11.0

### Minor Changes

- 71a223d: Added `extensions` field to `PaymentWrapperConfig` so paid MCP tools can declare Bazaar discovery metadata and appear in `/discovery/resources`.

### Patch Changes

- a051f48: Enables `ResourceServerExtension` to register resource-server verify/settle hooks, and enforces extension mutation policy: `enrichPaymentRequiredResponse` may only change `payTo` / `amount` / `asset` when those baseline values are vacant; `scheme` / `network` / `maxTimeoutSeconds` and baseline `extra` entries are immutable. `enrichSettlementResponse` may not rewrite facilitator core fields (`success`, `transaction`, `network`, etc.). Lifecycle hook contexts are typed as read-only for core protocol fields.
- Updated dependencies [a051f48]
- Updated dependencies [dc04108]
  - @bankofai/x402-core@2.11.0

## 2.10.0

### Minor Changes

- 9424291: chore: bump viem lockfile to 2.47.12

  Updates the resolved viem version across all direct dependencies, adding chain definitions for Mezo Testnet, MegaETH, Stable, and Stable Testnet that were missing from previously locked versions.

  - @bankofai/x402-core@2.10.0

## 2.9.0

### Minor Changes

- 2250cae: Migrated project from coinbase/x402 to x402-foundation/x402 organization

### Patch Changes

- Updated dependencies [8cf3fca]
- Updated dependencies [c0e3969]
- Updated dependencies [2250cae]
- Updated dependencies [d352574]
  - @bankofai/x402-core@2.9.0

## 2.8.0

### Minor Changes

- Updated dependencies [067f297]
- Updated dependencies [4c1e44f]
- Updated dependencies [5135fab]
  - @bankofai/x402-core@2.8.0

## 2.7.0

### Minor Changes

- Updated dependencies [8931cb3]
  - @bankofai/x402-core@2.7.0

## 2.6.0

### Minor Changes

- Updated dependencies
  - @bankofai/x402-core@2.6.0

## 2.5.0

### Minor Changes

- Updated dependencies [96a9db0]
- Updated dependencies [d0a2b11]
- Updated dependencies
  - @bankofai/x402-core@2.5.0

## 2.4.0

### Minor Changes

- Updated dependencies [57a5488]
- Updated dependencies [018181b]
- Updated dependencies [3fb55d7]
  - @bankofai/x402-core@2.4.0

## 2.3.0

### Patch Changes

- 9ec9f15: Fixed select payment requirements
- Updated dependencies [9ec9f15]
  - @bankofai/x402-core@2.3.1

## 2.3.0-alpha

- Initial alpha prerelease of @bankofai/x402-mcp package for Model Context Protocol integration with x402 payment protocol.
