---
"@bankofai/x402-tron": patch
---

Fail closed when upto Permit2 allowance or balance RPC reads fail or return invalid
uint256 values. Return chain_read_failed without leaking raw RPC diagnostics and
stop settlement before writeContract. Preserve insufficient allowance/funds reasons
and the resource extension's intentional pre-Approval allowance deferral; balance
checks and post-delegation revalidation remain mandatory.
