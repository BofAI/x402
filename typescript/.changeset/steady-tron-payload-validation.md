---
"@bankofai/x402-tron": patch
---

Return structured verification and settlement failures for missing or malformed TRON payment fields across GasFree, Exact, Upto, and Batch Settlement. GasFree responses identify the invalid payload field.

Align Batch Settlement voucher signature checks with the contract's ECDSA rules and release channel reservations when settlement fails before reaching the facilitator.
