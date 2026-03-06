# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
