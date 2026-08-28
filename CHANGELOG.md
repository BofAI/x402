# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-28

### Added

- Added the canonical `trc20ApprovalResourceSponsoring` Extension for TRON `exact`, `upto`, and the Permit2 deposit/top-up path of `batch-settlement`.
- Added a Facilitator resource-sponsoring runtime with Stake 2.0 resource sizing, bounded policy checks, persistent operation contracts, crash recovery, and resource reclamation.
- Added isolated TypeScript examples for sponsored `exact`, `upto`, and `batch-settlement` flows.

### Security

- Strictly decode the Client-signed, unbroadcast TRC-20 Approval before sponsorship and bind its owner, Permit2 spender, amount, lifetime, fee limit, network, token, and single-contract transaction shape to the selected payment operation.
- Validate Resource Owner delegate and undelegate transactions against the original intent before signing, including owner, receiver, resource type, amount, lock state, permission, and contract count.
- Recover interrupted operations across delegation, approval, settlement handoff, and reclamation states so stale resource delegation is not silently abandoned.

### Changed

- `@bankofai/x402-extensions` and `@bankofai/x402-tron` advance to `1.2.0`.
- `@bankofai/x402-express`, `@bankofai/x402-fastify`, `@bankofai/x402-hono`, and `@bankofai/x402-next` advance to `1.1.1` to consume the updated Extension package.
- Other public packages remain on `1.1.0` because their APIs and dependency graphs did not change in this release.

Implemented in [PR #84](https://github.com/BofAI/x402/pull/84).

## [1.1.0] - 2026-08-25

### Upgrade notes

- Upgrade all 11 `@bankofai/x402-*` packages together; published internal dependencies resolve to `~1.1.0`.
- Custom money parsers now receive decimal strings. Convert only for comparisons and preserve the string for token-amount conversion.
- TRON integrations should use canonical CAIP-2 identifiers: `tron:0xcd8690dc` (Nile), `tron:0x94a9059e` (Shasta), and `tron:0x2b6653dc` (mainnet).
- ERC-6492 facilitator deployments require an explicit `eip6492AllowedFactories` allowlist.

### Added

- Explicit `authorization`, `upfront`, and `escrow` payment-flow orchestration across core, HTTP, and MCP transports.
- Client spend caps, transaction limits, payment-selection policies, and lifecycle hooks.
- EVM support for deployed smart accounts, ERC-7702 delegation, and allowlisted ERC-6492 counterfactual wallets.
- Builder-code multi-service attribution, expanded SIWX validation, and dynamic extension-field handling.

### Changed

- Legacy v1.0 `SchemeNetworkServer` implementations may omit payment-flow declarations and continue using the authorization flow.
- `HTTPFacilitatorClient` now uses typed timeout errors, rate-limit retries, stricter response validation, and a 90-second default timeout.
- EVM and TRON price conversion preserves decimal precision and token-symbol selection across supported server schemes.
- README, release notes, package changelogs, examples, and the Node.js requirement are aligned with the v1.1.0 package set.

### Fixed

- Restored BSC default assets and tightened EVM Permit2 and settlement-receipt validation.
- Normalized nullable MCP fields for cross-SDK interoperability while preserving existing response metadata.
- Hardened Express, Fastify, Hono, and Next.js route matching against encoded separators and line terminators.
- Added a forced release build to prevent stale generated declarations from entering npm tarballs.

### Verified

- Format, lint, forced release build, and all 34 workspace test tasks pass.
- All 11 npm tarballs report version `1.1.0`, rewrite internal dependencies to `~1.1.0`, and contain no `workspace:` ranges or stale TRON fee declarations.

Implemented by [@roger-gan](https://github.com/roger-gan) in [PR #83](https://github.com/BofAI/x402/pull/83). See [RELEASE_NOTES.md](RELEASE_NOTES.md#v110--payment-flow-and-wallet-compatibility) for the full release notes.

## [1.0.0] - 2026-07-02

### Added — TypeScript-only SDK rewrite

- TypeScript-only pnpm/turbo monorepo published as granular `@bankofai/x402-*` packages (`core`, `evm`, `tron`, `fetch`, `express`, `mcp`, `extensions`).
- `core` and the EVM mechanism forked from the [`x402-foundation/x402`](https://github.com/x402-foundation/x402) upstream; TRON mechanism is in-house.
- Supported schemes: `exact` (ERC-3009 / Permit2), `upto`, `batch-settlement`, `auth-capture` (EVM), and `exact_gasfree` (TRON).
- BSC testnet USDT (`0x337610d2…`, 18 dec, permit2) added to the express `exact` example alongside DHLU and USDC.
- Mainnet USDT registered in the EVM default-asset registry (`eip155:56`, permit2).

### Changed

- Fetch client `TOKEN_ADDRESSES` indexed by chain family so `USDT` resolves to the correct contract per network (BSC testnet vs TRON Nile).
- README aligned with the TypeScript-only SDK; `.env-exact.example` lists USDT among EVM token options.
- The previous-generation Python + TypeScript SDK moved to `legacy/` for reference.

### Fixed

- TRON facilitator settle receipt polling switched from `trx.getTransaction` (fullNode preconfirm, which could transiently read `REVERT` on mainnet and cause false settle failures) to the fullNode `gettransactioninfobyid` endpoint, waiting for `blockNumber` + `receipt.result`. ~3-6s latency with authoritative results, mirroring tronpy's `get_transaction_info`.

### Verified

- BSC testnet USDT `exact` end-to-end settle: `0x477f00845964271d53cc36028756fa4ce260674ff6b103e6a86a47f2e79a9edd` (SUCCESS).
- TRON mainnet USDT `exact` on-chain success: `604f51c8…0acc` (`contractRet: SUCCESS`); receipt-polling fix verified against this tx.

## [0.6.0] - 2026-05-13

### Added — TypeScript / Python facilitator parity

- TS facilitator client, facilitator engine, Hono / Express middleware, and fetch wrapper.
- TS facilitator signer layer (`FacilitatorSigner`, `EvmFacilitatorSigner`, `TronFacilitatorSigner`) for off-chain typed-data verification, contract writes, balance checks, and receipt polling.
- TS `exact`, `exact_permit`, and `exact_gasfree` facilitator verify + settle paths, matching the Python facilitator behavior.
- Public TS exports for facilitator APIs, signer APIs, protocol constants, middleware, and updated mechanism constructors.

### Changed

- TS facilitator mechanisms now use explicit facilitator signers, aligning the TypeScript API with Python's signer-injected facilitator model.
- Python package metadata is aligned to the final `0.6.0` release version.
- `exact` fee quote now returns a zero-fee quote instead of `null`, matching the Python facilitator.

### Fixed

- TS TRON facilitator settlement derives the facilitator address from `TRON_FACILITATOR_PRIVATE_KEY` / `TRON_PRIVATE_KEY` when direct private-key signing is enabled. This keeps the transaction owner address aligned with the key used by TronWeb signing and fixes `Private key does not match address in transaction` during `exact_permit` settle.
- TS TRON facilitator startup warns when the direct-signing private key address differs from the agent-wallet active address, making stale keystore/env mismatches visible in QA logs.

### Verified

- TS SDK build passed.
- TS SDK test suite passed: 19 files / 158 tests.
- x402-demo TypeScript flow verified on TRON Nile:
  - `exact_gasfree`: `97ec5443edaf4bbe8633ee8fc0dc923c4809df4f95625718d1f33e499cf2313d`
  - `exact_permit`: `ae91d7e02fea6855f22ffcb945dbf280ff526f72ef156f997e22d4cc8c053e80`

## [0.6.0-beta.1] - 2026-05-13

### Added — TypeScript facilitator settlement parity

- TS facilitator signer layer (`FacilitatorSigner`, `EvmFacilitatorSigner`, `TronFacilitatorSigner`) for off-chain typed-data verification, contract writes, balance checks, and receipt polling.
- TS `exact` facilitator settlement for EVM and TRON via `transferWithAuthorization`.
- TS `exact_permit` facilitator settlement for EVM and TRON via `PaymentPermit.permitTransferFrom`.
- TS `exact_gasfree` facilitator verify + settle via GasFree API proxy, matching the Python facilitator behavior.
- Unit coverage for TS GasFree facilitator quote, verify, and settle paths.

### Changed

- TS facilitator mechanism constructors now use explicit facilitator signers, aligning the TypeScript API with Python's signer-injected facilitator model.
- `exact` fee quote now returns a zero-fee quote instead of `null`, matching the Python facilitator.

### Verified

- TS SDK build passed.
- TS SDK test suite passed: 19 files / 158 tests.
- Published npm beta: `@bankofai/x402@0.6.0-beta.1` under the `beta` dist-tag.
- x402-demo TypeScript flow verified on TRON Nile:
  - `exact_gasfree`: `97ec5443edaf4bbe8633ee8fc0dc923c4809df4f95625718d1f33e499cf2313d`
  - `exact_permit`: `6aeccd9ff25e9c241b08082ea11149177597ae041daf6aa5dd6c0b7c0634d20a`

## [0.6.0-beta.0] - 2026-05-12

### Added — TypeScript SDK 与 Python parity 对齐

- `FacilitatorClient` (`typescript/packages/x402/src/facilitator/client.ts`) — TS 端补齐对远程 facilitator 的客户端调用（`/supported`、`/fee/quote`、`/verify`、`/settle`），与 Python `bankofai.x402.facilitator.FacilitatorClient` 接口一致。
- `X402Facilitator` (`typescript/packages/x402/src/facilitator/x402Facilitator.ts`) — TS 端 facilitator 引擎，按 `(network, scheme)` 路由 `FacilitatorMechanism`，支持 EVM 地址 checksum 规范化，与 Python `bankofai.x402.facilitator.X402Facilitator` 接口一致。
- `x402Hono` / `x402Express` server middleware (`typescript/packages/x402/src/middleware/`) — Hono + Express 一行接入收费 API，框架无关核心逻辑封装在 `processX402Request`。
- `X402FetchClient` 增强 (`typescript/packages/x402/src/http/client.ts`) — 补齐 `put` / `patch` / `delete` 方法，支持注入 `fetchImpl` / `selector`；新增 `parsePaymentResponseHeader()` 从成功响应里提取 settle receipt。
- `FacilitatorError` (`typescript/packages/x402/src/errors.ts`) — facilitator HTTP / 协议错误类型，含 status + body。
- 公开协议常量 `PAYMENT_SIGNATURE_HEADER` / `PAYMENT_REQUIRED_HEADER` / `PAYMENT_RESPONSE_HEADER`。
- 测试覆盖：facilitator client (11) + facilitator engine (14) + middleware core (9) + Hono adapter (5) + Express adapter (4) + fetch client (7) = 50 个新测试，整体 101/101 通过。

### Changed

- Hono 和 Express 加为 `peerDependenciesMeta` 的可选 peer deps；不安装也能用框架无关核心。

### Fixed

- `test_nile_uses_default_without_api_key` 测试断言对齐 nile fallback RPC URL 行为（之前实现已加 fallback 但测试未跟上）。

### Released

- npm: `@bankofai/x402@0.6.0-beta.0`
- PyPI: `bankofai-x402==0.6.0b0`

## [0.5.9] - 2026-04-14

### Added

- Exact V2 compatibility with Coinbase x402 Foundation spec — `exact` scheme payload now conforms to the upstream V2 wire format for EVM and TRON
- BSC Testnet (eip155:97) support with DHLU test token for `exact` EVM payments
- BSC testnet smoke test examples (TypeScript and Python) under `examples/bsc-testnet-smoke/`
- `nativeExactEvm` unit tests for EVM exact scheme
- Server-side `x-payment-signature` verification tests (Python)

### Changed

- `nativeExact` / `nativeExactEvm` / `nativeExactTron` mechanisms updated to emit V2-compatible payloads (`authorization` structure with typed fields instead of flat hex blob)
- `PaymentPayload` TypeScript type expanded to support both V1 and V2 payload shapes
- Token registry (`tokens.ts`) updated with BSC testnet DHLU entry
- GasFree utility refactored for cleaner error handling and status polling

### Fixed

- TypeScript SDK local build restored for exact v2 (`package-lock.json` regenerated)
- Python `tx_verification` utility updated for V2 payload structure

### Breaking

- Minimum Node.js version raised from 18 to 20 (pnpm 10 requires Node >= 20)

## [0.5.8] - 2026-04-02

### Changed

- GasFree API endpoints now route through the BankOfAI proxy (`https://facilitator.bankofai.io/{mainnet,shasta,nile}`) instead of the upstream `open.gasfree.io` / `open-test.gasfree.io` endpoints — clients no longer need API keys or secrets
- `getGasFreeApiBaseUrl()` / `get_gasfree_api_base_url()` now throws `UnsupportedNetworkError` for unrecognised networks instead of returning a default fallback URL

### Fixed

- `GasFreeAPIClient` now supports `aclose()` and async context manager (`async with`) for proper resource cleanup
- Improved `GasFreeAPIClient` reliability with better error handling and connection management

### Removed

- HMAC-SHA256 signature authentication from `GasFreeAPIClient` — the BankOfAI proxy handles auth transparently
- `getGasFreeApiKey()` / `get_gasfree_api_key()` and `getGasFreeApiSecret()` / `get_gasfree_api_secret()` config helpers — no longer needed
- Deprecation stubs for removed gasfree auth functions — clean break for the proxy migration

## [0.5.7] - 2026-03-30

### Added

- Fallback RPC endpoint (`https://hptg.bankofai.io`) for TRON mainnet when `TRON_GRID_API_KEY` is not set — eliminates rate-limit failures for developers without a TronGrid API key
- `getTronRpcUrl()` helper in TypeScript for fallback-aware RPC URL resolution
- `TRON_MAINNET_FALLBACK_URL` constant in Python for consistent fallback endpoint reference
- Warning messages (Python `logger.warning`, TypeScript `console.warn`) when the fallback endpoint is in use

### Changed

- `resolveRpcUrl()` in TypeScript now delegates to `getTronRpcUrl()` for TRON networks, ensuring fallback logic is applied consistently
- `TronClientSigner.getTronWeb()` uses `getTronRpcUrl()` instead of directly indexing `TRON_RPC_URLS`

## [0.5.6] - 2026-03-29

### Fixed

- `SufficientBalancePolicy` now checks balance via the mechanism's `check_balance()` / `checkBalance()` method instead of querying the signer's wallet directly — fixes incorrect balance lookups for GasFree payments where spendable balance lives in a separate custodial address
- Eliminated redundant GasFree API call in `create_payment_payload` by reusing the `_check_gasfree_balance` helper
- Removed unnecessary `await` on synchronous `getAddress()` in TypeScript GasFree mechanism
- Fixed misleading test name that said "drops" but asserted "keeps"

### Added

- `check_balance()` / `checkBalance()` method on `ClientMechanism` interface — mechanisms can override to check balance at the correct address for their payment scheme
- `resolve_mechanism()` / `resolveMechanism()` public method on `X402Client` for policies to look up mechanisms by scheme+network
- Policy test suites for both Python and TypeScript covering sufficient/insufficient balance, missing mechanism, exception resilience, and all-unaffordable scenarios

### Changed

- `SufficientBalancePolicy` now drops requirements with no matching mechanism (previously kept them); safe within the `X402Client` pipeline where mechanism filtering already runs upstream

## [0.5.5] - 2026-03-28

### Fixed

- Handle null `data` in GasFree status API responses that caused `AttributeError` / `TypeError` during settlement polling
- Retry transient HTTP errors during `waitForSuccess` polling instead of crashing the settlement flow
- Abort polling after `max_errors` (default: 3) consecutive failures to avoid silently retrying permanent errors until timeout
- Reset error counter after each successful poll so only truly consecutive errors trigger abort
- Explicit null guards on all GasFree API response `data` fields (`getAddressInfo`, `getProviders`, `submit`)
- Guard `submit` return value against missing `id` field
- Fix variable shadowing in Python `submit` (`message` parameter shadowed by local)
- Use `is None` / `== null` checks for precision (avoids false positives on falsy values)

### Changed

- `GasFreeResponse<T>.data` typed as `T | null` in TypeScript to reflect actual API contract
- `getStatus` / `get_status` return type widened to nullable
- `waitForSuccess` / `wait_for_success` accepts `max_errors` / `maxErrors` parameter (default: 3)
- Timeout error messages now include error count for better observability

## [0.5.4] - 2026-03-27

### Fixed

- Clamp GasFree client deadlines to provider bounds (mainnet: 50–600s, others: 50–3600s)
- Add a 5s safety margin: +5s to min and −5s to max to absorb clock drift and network latency
- When above provider max, clamp down (never extend beyond max); when below min, fail fast
- Align GasFree default deadline fallback to the per-network max to avoid noisy clamps

### Added

- Log when a GasFree deadline is clamped for easier diagnosis

## [0.5.3] - 2026-03-27

### Fixed

- Align TRON mainnet GasFreeController address with GasFree SDK to prevent TIP-712 signature verification mismatches

### Added

- GasFree client signing logs (signer, domain, message) to aid signature debugging

## [0.5.1] - 2026-03-26

### Fixed

- TypeScript GasFree TIP-712 signing now converts all address fields to EVM `0x` format before signing

### Added

- Tests to assert GasFree TIP-712 signing uses EVM-formatted addresses (TypeScript and Python)

## [0.5.0] - 2026-03-18

### Changed

- Refactored client and facilitator signers to accept wallet instances and resolve addresses through async factory methods
- Standardized signer integration around the agent-wallet `Wallet` capability surface for message, typed-data, and transaction signing
- Normalized TRON transaction signing by extracting signatures from wallet-signed transaction payloads when wallets return full signed transaction JSON

## [0.4.2] - 2026-03-11

### Added

- **GasFree activateFee support**: When a TRON GasFree account is not yet activated, `activateFee` from the API asset info is now included in `maxFee` calculation to prevent transaction failures due to insufficient fee allowance.
- Comprehensive test coverage for activateFee edge cases (both Python and TypeScript SDKs):
  - activateFee included when account not activated
  - activateFee ignored when account already activated
  - Zero activateFee handled correctly
  - Missing activateFee field defaults to 0
  - activateFee stacks on top of higher facilitator fee
  - Balance check accounts for activateFee

## [0.4.1] - 2026-03-07

### Removed

- `SupportedResponse.fee` field (Python and TypeScript) — fee info is now exclusively via `/fee/quote`
- `pricing` parameter from `X402Facilitator.supported()`

### Fixed

- Added missing `scheme` and `asset` fields to TypeScript `FeeQuoteResponse` interface
- `SettleResponse` error paths now include `network` field in `X402Facilitator` and `X402Server`
- `FacilitatorClient` HTTP timeout increased from 30s to 120s for GasFree settlement

## [0.4.0] - 2026-02-25

### Added

- **GasFree Support**: Full integration for the GasFree payment scheme on TRON. Users can pay with USDT/USDD without holding TRX for gas.
- **Facilitator Provider Selection**: `ExactGasFreeFacilitatorMechanism.fee_quote()` selects a GasFree provider and returns it via `feeTo`/`caller`. Clients use the provider from `requirements.extra.fee` with automatic fallback to the GasFree API.
- **GasFree Facilitator Validation**: Comprehensive permit validation including token whitelist, fee amount floor, deadline expiry, and provider allowlist checks.
- **Transaction Polling**: Facilitator supports asynchronous polling for GasFree transaction status (`SUCCEED`/`FAILED`) with a 3-minute grace period.
- **Cross-Language Integration**: Validated interoperability between TypeScript Client and Python Facilitator for both `exact_permit` and `exact_gasfree` payments.

### Changed

- **Signer Refactor**: Standardized EIP-712 / TIP-712 signers to be **Domain Neutral**. `sign_typed_data` and `verify_typed_data` now require an explicit `primary_type` argument.
- **EIP-712 Type Definitions**: `EIP712Domain` is no longer included in type dictionaries — domain is passed separately, consistent with ethers v6 / TronWeb v6 conventions.
- **Constants Standardized**: Standardized naming for protocol-specific EIP-712 constants (`GASFREE_PRIMARY_TYPE`, `PAYMENT_PERMIT_EIP712_DOMAIN_TYPE`).
- **Client Fee Logic**: `maxFee` calculated as `max(transferFee, facilitatorFee)`, with fallback to 1 token only when no fee info is provided.
- **`@gasfree/gasfree-sdk` Import**: Uses default import with destructuring for CJS/ESM compatibility.
- **Improved Logging**: Enhanced facilitator audit logs and resource usage tracking.
- **Pydantic Models**: Consistent field naming across response models. Optional `web3.py` dependency handling in EVM signers.

## [0.1.6] - 2026-02-06

### Fixed

- tronpy client now supports TronGrid API key via `TRON_GRID_API_KEY`

## [0.1.5] - 2026-02-05

### Added

- Multi-network facilitator support (Nile and Mainnet simultaneously)
- Async transaction verification with AsyncTron client

### Changed

- Updated PaymentPermit contract addresses:
  - Mainnet: `THnW1E6yQWgx9P3QtSqWw2t3qGwH35jARg`
  - Shasta: `TVjYLoXatyMkemxzeB9M8ZE3uGttR9QZJ8`
  - Nile: `TQr1nSWDLWgmJ3tkbFZANnaFcB5ci7Hvxa`
- Server automatically fetches facilitator address from `/supported` endpoint
- Removed `max_amount` filter from `PaymentRequirementsFilter`
- All tronpy operations converted to AsyncTron with proper async/await
- Simplified transaction verification to status check only (60s timeout)

### Fixed

- Fixed on-chain transaction failure: `permit.caller` now matches facilitator address
- Fixed contract ABI to match new PaymentPermit deployment
- Fixed all linting and formatting issues
- Fixed test imports to use new mechanism names

[0.1.5]: https://github.com/BofAI/x402-tron/releases/tag/v0.1.5

## [0.1.4] - 2026-02-05

### Added

#### Core Protocol

- x402 payment protocol implementation for TRON blockchain
- Support for TRON Mainnet, Nile, and Shasta testnets
- TIP-712 (TRON's EIP-712) signature support
- "upto" payment scheme for pay-per-use APIs

#### Python SDK (v0.1.4)

- `X402Server` - Resource server with payment protection
- `X402Client` - Client SDK for creating payment permits
- `X402Facilitator` - Facilitator server for payment settlement
- `X402HttpClient` - HTTP client with automatic 402 handling
- FastAPI integration via `x402_protected` decorator
- TRON client, server, and facilitator mechanisms
- TIP-712 signers for TRON
- Token registry with USDT support
- Comprehensive test suite

#### TypeScript SDK (v0.1.4)

- `X402Client` - Core payment client
- `X402FetchClient` - Fetch-based HTTP client with automatic 402 handling
- `UptoTronClientMechanism` - TRON payment mechanism
- `TronClientSigner` - TIP-712 signature support
- Token approval management
- Full TypeScript type definitions

### Changed

- Examples moved to separate repository: [x402-tron-demo](https://github.com/BofAI/x402-tron-demo)

[0.1.4]: https://github.com/BofAI/x402-tron/releases/tag/v0.1.4
