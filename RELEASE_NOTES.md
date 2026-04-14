# v0.5.9 - Exact V2 Compatibility

Release date: April 14, 2026

## Changes

- **Exact V2 spec alignment**: The `exact` payment scheme (EVM and TRON) now produces V2-compatible payloads that conform to the x402 Foundation (formerly Coinbase) wire format. This enables interoperability with the upstream facilitator and other V2-compliant implementations.
- **BSC Testnet support**: Added BSC Testnet (`eip155:97`) with DHLU test token for `exact` EVM payments. Includes smoke test examples in both TypeScript and Python.
- **Payload structure update**: `nativeExact`, `nativeExactEvm`, and `nativeExactTron` mechanisms now emit structured `authorization` objects instead of flat hex blobs, matching the V2 spec.
- **GasFree utility cleanup**: Refactored status polling and error handling in the GasFree API client.

## Verification

- TypeScript: 51/51 tests passed (8 test files)
- Python: 217/217 tests passed
- BSC Testnet end-to-end: settlement tx confirmed on `eip155:97`

## Affected SDKs

- **Python**: `bankofai-x402==0.5.9`
- **TypeScript**: `@bankofai/x402@0.5.9`
