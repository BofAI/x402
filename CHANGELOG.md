# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
