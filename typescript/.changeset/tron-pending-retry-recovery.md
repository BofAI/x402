---
"@bankofai/x402-tron": patch
---

Reconcile original TRON transactions when official Core retries pending settlement, instead of broadcasting the payment again. Preserve batch pre-broadcast snapshots and GasFree relayer trace IDs, and expose a pending settlement store with exclusive locking for durable/shared facilitator deployments. Storage failures preserve known transaction IDs and reject unsafe retries.
