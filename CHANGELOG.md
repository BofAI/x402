# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.5]: https://github.com/BofAI/x402/releases/tag/v0.1.5

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
- Examples moved to separate repository: [x402-demo](https://github.com/BofAI/x402-demo)

[0.1.4]: https://github.com/BofAI/x402/releases/tag/v0.1.4
