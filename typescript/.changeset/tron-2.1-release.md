---
"@bankofai/x402-tron": minor
"@bankofai/x402-tron-extensions": minor
"@bankofai/x402-express": patch
"@bankofai/x402-fastify": patch
"@bankofai/x402-hono": patch
"@bankofai/x402-next": patch
---

Use official Core 2.28.0 for TRON payments and move resource sponsorship into
`@bankofai/x402-tron-extensions`, requiring explicit extension registration.

Reject failed upto RPC reads, enforce batch/GasFree spend caps, and recover pending
settlements using their original transaction or relayer trace without rebroadcasting.
Production recovery requires persistent storage with shared locking.

Remove legacy and local EVM packages. Use official `@x402/evm@2.28.0` and
`@x402/extensions@2.28.0` directly for upstream functionality.
