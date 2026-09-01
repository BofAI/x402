---
"@bankofai/x402-tron": minor
"@bankofai/x402-core": patch
---

Add configurable TRON receipt confirmation waiting with a 90-second default and preserve broadcast
transaction IDs in non-terminal `settlement_pending` responses across exact, upto, batch, and
GasFree settlement paths. Distinguish low-latency packed receipts from solidified receipts, expose
read-only exact, upto, exact_gasfree, and batch-settlement reconciliation APIs, and validate each
scheme's settlement target, calldata constraints, and on-chain effects before reporting success.
Return a durable versioned reconciliation context with broadcast responses and keep incomplete or
malformed receipt data pending via explicit match/mismatch/indeterminate classification. Runtime-
validate persisted context versions before reconciliation and reject malformed GasFree relayer
transaction hashes instead of returning unreconcilable success or pending records.

Increase the default HTTP facilitator client timeout to 120 seconds so the default TRON receipt
budget leaves time to return the settlement response.
