# @bankofai/x402-extensions Changelog

## 1.2.0

### Minor Changes

- [#84](https://github.com/BofAI/x402/pull/84) [`7a77b61`](https://github.com/BofAI/x402/commit/7a77b611046b26106193079e5ef4fbe76f4dcacd) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Added the `trc20ApprovalResourceSponsoring` Extension for TRON `exact`, `upto`, and the Permit2 deposit/top-up path of `batch-settlement`. Resource Servers can advertise the canonical version 1 schema, Clients can attach a fully signed but unbroadcast TRC-20 Approval with a fixed 600-second minimum lifetime, and Facilitators can register a resource-sponsoring runtime. The TRON mechanism strictly decodes and validates the signed protobuf and binds it to the selected Permit2 operation before any resource lifecycle is executed. The TRON package also provides a production-oriented resource state machine, TronWeb chain driver, Stake 2.0 sizing, immutable action persistence contracts, bounded policy helpers, unknown-state recovery, and an explicit process-local coordinator for tests and development. TRON transaction signing now normalizes wallet recovery bytes for node broadcast while the Approval validator accepts both standard encodings, and the chain driver handles TronWeb's string account types plus successful system receipts that omit `receipt.result`.

## 1.1.0

### Minor Changes

- Release the aligned v1.1.0 TypeScript SDK package set. This release adds explicit payment-flow orchestration, client spend controls and hooks, improved remote facilitator timeout and error handling, EVM smart-wallet and settlement receipt support, TRON money parsing and canonical network identifiers, cross-SDK MCP normalization, extension improvements, and HTTP middleware hardening.

### Patch Changes

- Updated dependencies []:
  - @bankofai/x402-core@1.1.0

## 2.15.0

### Minor Changes

- [ae0bf9b](https://github.com/x402-foundation/x402/commit/ae0bf9b): builder-code: accept and encode multiple service codes (`s`). The client extension now accepts a string or an array of codes, and the facilitator/CBOR layers encode and parse every valid entry, so layered clients (e.g. an MCP middleware) can attribute multiple participants onchain. ([#2606](https://github.com/x402-foundation/x402/pull/2606)) - Thanks [@phdargen](https://github.com/phdargen)!
- [6acb8fc](https://github.com/x402-foundation/x402/commit/6acb8fc): Implemented builder-code extension ([#2329](https://github.com/x402-foundation/x402/pull/2329)) - Thanks [@0xClouds](https://github.com/0xClouds) and [@pk-coinbase](https://github.com/pk-coinbase), [@phdargen](https://github.com/phdargen)!
- Updated dependencies [bfa580e](https://github.com/x402-foundation/x402/commit/bfa580e)
- Updated dependencies [3a60816](https://github.com/x402-foundation/x402/commit/3a60816)
- Updated dependencies [7539e93](https://github.com/x402-foundation/x402/commit/7539e93)
  - @bankofai/x402-core@2.15.0

### Patch Changes

- [7539e93](https://github.com/x402-foundation/x402/commit/7539e93): Fixed client extension echo merging to preserve server-declared extension fields while adding client-provided extension data ([#2561](https://github.com/x402-foundation/x402/pull/2561)) - Thanks [@phdargen](https://github.com/phdargen)!

## 2.14.0

### Minor Changes

- be788e0: Thread Bazaar service metadata from HTTP `RouteConfig` and MCP `PaymentWrapperConfig` into `PaymentRequired.resource`, and extend bazaar facilitator discovery/catalog types so verified payments persist description, MIME type, service metadata, and echoed extension payloads.
- Updated dependencies [be788e0]
- Updated dependencies [0af31dd]
  - @bankofai/x402-core@2.14.0

## 2.13.0

### Minor Changes

- 49ea054: Use extension hook adapters and auto-register hooks in SIWX extension
- Updated dependencies [ad08a9a]
- Updated dependencies [5fca9f3]
- Updated dependencies [95f2094]
- Updated dependencies [49ea054]
  - @bankofai/x402-core@2.13.0

## 2.12.0

### Minor Changes

- 608034f: Added Bazaar service metadata fields (`serviceName`, `tags`, `iconUrl`) on `ResourceInfo`, plus `isValidServiceName` / `sanitizeTags` / `isValidIconUrl` / `sanitizeResourceServiceMetadata` helpers in `@bankofai/x402-extensions/bazaar` that `extractDiscoveryInfo` now applies with soft-drop semantics. Fields are optional and additive — providers that omit them produce byte-identical 402 bodies.
- ee7c156: chore: tighten viem dependency floor to ^2.48.11

  Raises the viem floor in every `@bankofai/x402-*` package.json that lists viem as a direct dep so future `pnpm install` re-resolutions cannot regress below this version. Fixes the incomplete tightening from #2013.

- Updated dependencies [608034f]
- Updated dependencies [d235050]
- Updated dependencies [45d7d19]
  - @bankofai/x402-core@2.12.0

## 2.11.0

### Minor Changes

- Updated dependencies [a051f48]
- Updated dependencies [dc04108]
  - @bankofai/x402-core@2.11.0

## 2.10.0

### Minor Changes

- 9424291: chore: bump viem lockfile to 2.47.12

  Updates the resolved viem version across all direct dependencies, adding chain definitions for Mezo Testnet, MegaETH, Stable, and Stable Testnet that were missing from previously locked versions.

- a4e4911: Migrate SIWE dependency from `siwe` (Spruce) to `@signinwithethereum/siwe` (Ethereum Identity Foundation). The new package is the official successor, supports viem natively as a peer dependency, and maintains the same `SiweMessage` API.
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

- 4f2f4f3: Added auth-only route support in createSIWxRequestHook via accepts: [] detection
- 067f297: Added dynamic route support to the Bazaar discovery extension — servers can now declare `[param]` route segments that consolidate to a single catalog entry per route template, with automatic `pathParams` enrichment and `:param`-style `routeTemplate` in discovery output.

### Patch Changes

- Updated dependencies [067f297]
- Updated dependencies [4c1e44f]
- Updated dependencies [5135fab]
  - @bankofai/x402-core@2.8.0

## 2.7.0

### Minor Changes

- 8b731cb: Replaced `sendRawApprovalAndSettle` with a generic `sendTransactions` signer method that accepts an array of pre-signed serialized transactions or unsigned call intents. The signer owns execution strategy (sequential, batched, or atomic bundling). Closed fail-open verification paths, aligned Permit2 amount check to exact match, and added `signerForNetwork` to the extensions package.
- f2bbb5c: Added offer-receipt extension to enable signed offers and receipts in x402 payment flows

### Patch Changes

- 34d2442: Removed dependencie on node’s crypto module
- Updated dependencies [8931cb3]
  - @bankofai/x402-core@2.7.0

## 2.6.0

### Minor Changes

- Updated dependencies
  - @bankofai/x402-core@2.6.0

## 2.5.0

### Minor Changes

- 7fe268f: Implemented the erc20 approval gas sponsorship extension

### Patch Changes

- 1ab1c86: Guard against undefined `resource` in SIWX settle hook to prevent runtime crash when `PaymentPayload.resource` is absent
- Updated dependencies [96a9db0]
- Updated dependencies [d0a2b11]
- Updated dependencies
  - @bankofai/x402-core@2.5.0

## 2.4.0

### Minor Changes

- 018181b: Implement EIP-2612 gasless Permit2 approval extension

  - Added `eip2612GasSponsoring` extension types, resource service declaration, and facilitator validation utilities

- 664285e: Add MCP tool discovery support to the bazaar extension system

### Patch Changes

- 3fb55d7: Upgraded facilitator extension registration from string keys to FacilitatorExtension objects. Added FacilitatorContext threaded through SchemeNetworkFacilitator.verify/settle for mechanism access to extension capabilities
- Updated dependencies [57a5488]
- Updated dependencies [018181b]
- Updated dependencies [3fb55d7]
  - @bankofai/x402-core@2.4.0

## 2.3.1

### Patch Changes

- f93fc09: Added solanakit support for siwx
- Updated dependencies [9ec9f15]
  - @bankofai/x402-core@2.3.1

## 2.3.0

### Minor Changes

- fe42994: Added Sign-In-With-X (SIWX) extension for wallet-based authentication. Clients can prove previous payment by signing a message, avoiding re-payment. Supports EVM and Solana signature schemes with multi-chain support, lifecycle hooks for servers and clients, and optional nonce tracking for replay protection.
- 51b8445: Added payment-identifier extension for tracking and validating payment identifiers

### Patch Changes

- Updated dependencies [51b8445]
- Updated dependencies [51b8445]
  - @bankofai/x402-core@2.3.0

## 2.0.0

- Implements x402 2.0.0 for the TypeScript SDK.

## 1.0.0

- Implements x402 1.0.0 for the TypeScript SDK.
