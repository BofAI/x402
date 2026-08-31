---
"@bankofai/x402-tron": minor
"@bankofai/x402-core": patch
---

Add configurable TRON receipt confirmation waiting with a 90-second default and preserve broadcast
transaction IDs in non-terminal `settlement_pending` responses across exact, upto, and batch
settlement paths.

Increase the default HTTP facilitator client timeout to 120 seconds so the default TRON receipt
budget leaves time to return the settlement response.
