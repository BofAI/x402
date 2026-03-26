# v0.5.1 - GasFree TIP-712 Address Fix

Release date: March 26, 2026

## What's New

- **GasFree TIP-712 signing now uses EVM addresses**: The TypeScript GasFree client converts all address fields to EVM `0x` format before signing to ensure signatures match the expected domain/message encoding.
- **Stronger test coverage**: Added tests in both TypeScript and Python to assert that GasFree TIP-712 signing uses EVM-formatted addresses.

## Breaking Changes

None.

## Affected SDKs

- **Python**: `bankofai-x402==0.5.1`
- **TypeScript**: `@bankofai/x402@0.5.1`
