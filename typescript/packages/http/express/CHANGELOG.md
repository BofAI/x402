# @bankofai/x402-express Changelog

## 1.1.1

### Patch Changes

- Updated dependencies [[`7a77b61`](https://github.com/BofAI/x402/commit/7a77b611046b26106193079e5ef4fbe76f4dcacd)]:
  - @bankofai/x402-extensions@1.2.0

## 1.1.0

### Minor Changes

- Release the aligned v1.1.0 TypeScript SDK package set. This release adds explicit payment-flow orchestration, client spend controls and hooks, improved remote facilitator timeout and error handling, EVM smart-wallet and settlement receipt support, TRON money parsing and canonical network identifiers, cross-SDK MCP normalization, extension improvements, and HTTP middleware hardening.

### Patch Changes

- Updated dependencies []:
  - @bankofai/x402-core@1.1.0
  - @bankofai/x402-extensions@1.1.0

## 2.15.0

### Minor Changes

- Updated dependencies [ae0bf9b](https://github.com/x402-foundation/x402/commit/ae0bf9b)
- Updated dependencies [bfa580e](https://github.com/x402-foundation/x402/commit/bfa580e)
- Updated dependencies [6acb8fc](https://github.com/x402-foundation/x402/commit/6acb8fc)
- Updated dependencies [3a60816](https://github.com/x402-foundation/x402/commit/3a60816)
- Updated dependencies [7539e93](https://github.com/x402-foundation/x402/commit/7539e93)
  - @bankofai/x402-extensions@2.15.0
  - @bankofai/x402-core@2.15.0
  - @bankofai/x402-paywall@2.15.0

### Patch Changes

- [4ddba37](https://github.com/x402-foundation/x402/commit/4ddba37): Strip internal settlement-overrides header after settlement reads it, so its not exposed to the client ([#2556](https://github.com/x402-foundation/x402/pull/2556)) - Thanks [@phdargen](https://github.com/phdargen)!

## 2.14.0

### Minor Changes

- 0af31dd: Added startup-time JSON-schema validation for bazaar discovery extensions in middleware packages; Removed shallow bazaar validation from core in favor of full schema validation using the extensions package validator
- Updated dependencies [be788e0]
- Updated dependencies [0af31dd]
  - @bankofai/x402-extensions@2.14.0
  - @bankofai/x402-core@2.14.0
  - @bankofai/x402-paywall@2.14.0

## 2.13.0

### Minor Changes

- Updated dependencies [49ea054]
- Updated dependencies [e35becf]
- Updated dependencies [ad08a9a]
- Updated dependencies [f3deb60]
- Updated dependencies [5fca9f3]
- Updated dependencies [95f2094]
- Updated dependencies [49ea054]
  - @bankofai/x402-extensions@2.13.0
  - @bankofai/x402-paywall@2.13.0
  - @bankofai/x402-core@2.13.0

## 2.12.0

### Minor Changes

- 45d7d19: Added cancellationDispatcher for failed route handlers
- ee7c156: chore: tighten viem dependency floor to ^2.48.11

  Raises the viem floor in every `@bankofai/x402-*` package.json that lists viem as a direct dep so future `pnpm install` re-resolutions cannot regress below this version. Fixes the incomplete tightening from #2013.

- Updated dependencies [608034f]
- Updated dependencies [d235050]
- Updated dependencies [45d7d19]
- Updated dependencies [ee7c156]
  - @bankofai/x402-core@2.12.0
  - @bankofai/x402-extensions@2.12.0
  - @bankofai/x402-paywall@2.12.0

## 2.11.0

### Minor Changes

- Updated dependencies [a051f48]
- Updated dependencies [032295b]
- Updated dependencies [dc04108]
- Updated dependencies [484030b]
  - @bankofai/x402-core@2.11.0
  - @bankofai/x402-paywall@2.11.0
  - @bankofai/x402-extensions@2.11.0

## 2.10.0

### Minor Changes

- Updated dependencies [a25800e]
- Updated dependencies [9424291]
- Updated dependencies [37b8347]
- Updated dependencies [a4e4911]
  - @bankofai/x402-paywall@2.10.0
  - @bankofai/x402-extensions@2.10.0
  - @bankofai/x402-core@2.10.0

## 2.9.0

### Minor Changes

- 2250cae: Migrated project from coinbase/x402 to x402-foundation/x402 organization
- d352574: Add SettlementOverrides support for partial settlement (upto scheme). Route handlers can call setSettlementOverrides() to settle less than the authorized maximum, enabling usage-based billing.

### Patch Changes

- Updated dependencies [8cf3fca]
- Updated dependencies [c0e3969]
- Updated dependencies [2250cae]
- Updated dependencies [d352574]
  - @bankofai/x402-core@2.9.0
  - @bankofai/x402-paywall@2.9.0
  - @bankofai/x402-extensions@2.9.0

## 2.8.0

### Minor Changes

- 4c1e44f: Treat malformed facilitator success payloads as upstream facilitator errors and return 502 responses from framework middleware instead of flattening them into payment failures.
- Updated dependencies [4f2f4f3]
- Updated dependencies [067f297]
- Updated dependencies [067f297]
- Updated dependencies [4c1e44f]
- Updated dependencies [5135fab]
  - @bankofai/x402-extensions@2.8.0
  - @bankofai/x402-core@2.8.0
  - @bankofai/x402-paywall@2.8.0

## 2.7.0

### Minor Changes

- Updated dependencies [34d2442]
- Updated dependencies [8b731cb]
- Updated dependencies [f2bbb5c]
- Updated dependencies [8931cb3]
- Updated dependencies [34d2442]
  - @bankofai/x402-extensions@2.7.0
  - @bankofai/x402-core@2.7.0
  - @bankofai/x402-paywall@2.7.0

## 2.6.0

### Minor Changes

- aeef1bf: Added dynamic function for servers to generate custom response for settlement failures defaulting to empty
- 205257b: Cleaned up dependencies
- 2564781: Include PAYMENT-RESPONSE header on settlement failure responses
- Updated dependencies [f41baed]
- Updated dependencies [aeef1bf]
- Updated dependencies [2564781]
- Updated dependencies [b341973]
- Updated dependencies [29fe09a]
  - @bankofai/x402-core@2.6.0
  - @bankofai/x402-paywall@2.6.0

## 2.5.0

### Minor Changes

- Updated dependencies [96a9db0]
- Updated dependencies [7fe268f]
- Updated dependencies [1ab1c86]
- Updated dependencies [d0a2b11]
- Updated dependencies
  - @bankofai/x402-core@2.5.0
  - @bankofai/x402-extensions@2.5.0
  - @bankofai/x402-paywall@2.4.1

## 2.4.0

### Minor Changes

- Updated dependencies [57a5488]
- Updated dependencies [018181b]
- Updated dependencies [3fb55d7]
  - @bankofai/x402-core@2.4.0
  - @bankofai/x402-extensions@2.4.0
  - @bankofai/x402-paywall@2.4.0

## 2.3.0

### Minor Changes

- 51b8445: Bumped @bankofai/x402-core dependency to 2.3.0

### Patch Changes

- Updated dependencies [51b8445]
- Updated dependencies [51b8445]
- Updated dependencies [51b8445]
- Updated dependencies [fe42994]
- Updated dependencies [51b8445]
  - @bankofai/x402-core@2.3.0
  - @bankofai/x402-paywall@2.3.0
  - @bankofai/x402-extensions@2.3.0

## 2.0.0

- Implements x402 2.0.0 for the TypeScript SDK.

## 1.0.0

- Implements x402 1.0.0 for the TypeScript SDK.
