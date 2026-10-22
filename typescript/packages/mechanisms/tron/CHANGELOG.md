# @bankofai/x402-tron

## 2.1.0-beta.3

- Recover pending exact, upto, batch, and GasFree settlements using the original transaction or relayer trace, without repeating authorization, resource sponsorship, or broadcast. Preserve batch snapshots and redact storage failures.
- Expose an injectable pending settlement store; production recovery requires persistent shared storage with exclusive locking.
- Align all TRON examples with official Core and HTTP/MCP integrations. Move the Nile resource-sponsoring integration entrypoint and environment template to the independent extension package.

## 2.1.0-beta.2

- Reject upto allowance/balance RPC failures and malformed uint256 reads with `chain_read_failed`. Settlement and resource revalidation stop before payment broadcast. Preserve explicit insufficient allowance/funds errors and sponsored Approval allowance deferral.

## 2.1.0-beta.1

- Correct the legacy `module` field to the built `.mjs` entry and verify all package entry fields.
- Continue the release line as 2.1.0-beta.1; keep the earlier 3.0.0 beta as historical experimental publication.
- Enforce official Core atomic spend caps against batch deposits and GasFree value plus fee before signing.
- Migration beta: use official Core 2.28.0 and move resource-runtime imports to the independent extension package; this is not a drop-in source upgrade from SDK2.


## 3.0.0-beta.1

- Use official `@x402/core@2.28.0` for all four TRON mechanisms; old Core is no longer a runtime dependency.
- Separate signing, wallet adaptation, RPC configuration and transaction utilities; preserve compatible wallet factories.
- Move resource sponsorship into `@bankofai/x402-tron-extensions@3.0.0-beta.1`; explicitly register client and facilitator extensions.
- Support strict ESM/CJS consumers and publish the two TRON packages on a shared version line.
- Beta limitation: live-chain service integration and production durable-coordinator recovery remain pending. Upto allowance/balance RPC errors currently retain the previous optimistic verification behavior; the fail-closed change is required before a stable release.

## 2.0.0

### Major Changes

- [#96](https://github.com/BofAI/x402/pull/96) [`42829dc`](https://github.com/BofAI/x402/commit/42829dccb243b1160c301886bd53725fbb76bb7f) Thanks [@roger-gan](https://github.com/roger-gan)! - Use decimal TRON CAIP-2 identifiers as canonical network values while accepting deprecated hexadecimal aliases at protocol and configuration boundaries.

### Minor Changes

- [#98](https://github.com/BofAI/x402/pull/98) [`bce7b6c`](https://github.com/BofAI/x402/commit/bce7b6ccd656953d8e65b740761eede60eab3934) Thanks [@roger-gan](https://github.com/roger-gan)! - Add configurable TRON receipt confirmation waiting with a 90-second default and preserve broadcast transaction IDs in non-terminal `settlement_pending` responses across exact, upto, and batch settlement paths. GasFree settlement now validates relayer transaction IDs and preserves a valid relayer-observed transaction ID when later status polling becomes indeterminate.

  Increase the default HTTP facilitator client timeout to 120 seconds so the default TRON receipt budget leaves time to return the settlement response.

### Patch Changes

- Updated dependencies [[`42829dc`](https://github.com/BofAI/x402/commit/42829dccb243b1160c301886bd53725fbb76bb7f), [`bce7b6c`](https://github.com/BofAI/x402/commit/bce7b6ccd656953d8e65b740761eede60eab3934)]:
  - @bankofai/x402-core@1.1.1

## 1.2.0

### Minor Changes

- [#84](https://github.com/BofAI/x402/pull/84) [`7a77b61`](https://github.com/BofAI/x402/commit/7a77b611046b26106193079e5ef4fbe76f4dcacd) Thanks [@boboliu-1010](https://github.com/boboliu-1010)! - Added the `trc20ApprovalResourceSponsoring` Extension for TRON `exact`, `upto`, and the Permit2 deposit/top-up path of `batch-settlement`. Resource Servers can advertise the canonical version 1 schema, Clients can attach a fully signed but unbroadcast TRC-20 Approval with a fixed 600-second minimum lifetime, and Facilitators can register a resource-sponsoring runtime. The TRON mechanism strictly decodes and validates the signed protobuf and binds it to the selected Permit2 operation before any resource lifecycle is executed. The TRON package also provides a production-oriented resource state machine, TronWeb chain driver, Stake 2.0 sizing, immutable action persistence contracts, bounded policy helpers, unknown-state recovery, and an explicit process-local coordinator for tests and development. TRON transaction signing now normalizes wallet recovery bytes for node broadcast while the Approval validator accepts both standard encodings, and the chain driver handles TronWeb's string account types plus successful system receipts that omit `receipt.result`.

## 1.1.0

### Minor Changes

- Release the aligned v1.1.0 TypeScript SDK package set. This release adds explicit payment-flow orchestration, client spend controls and hooks, improved remote facilitator timeout and error handling, EVM smart-wallet and settlement receipt support, TRON money parsing and canonical network identifiers, cross-SDK MCP normalization, extension improvements, and HTTP middleware hardening.

### Patch Changes

- Updated dependencies []:
  - @bankofai/x402-core@1.1.0
