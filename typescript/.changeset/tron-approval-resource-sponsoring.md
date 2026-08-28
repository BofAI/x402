---
"@bankofai/x402-extensions": minor
"@bankofai/x402-tron": minor
---

Added the `trc20ApprovalResourceSponsoring` Extension for TRON `exact`, `upto`, and the Permit2
deposit/top-up path of `batch-settlement`. Resource Servers can advertise the canonical version 1
schema, Clients can attach a fully signed but unbroadcast TRC-20 Approval with a fixed 600-second
minimum lifetime, and Facilitators can register a resource-sponsoring runtime. The TRON mechanism
strictly decodes and validates the signed protobuf and binds it to the selected Permit2 operation
before any resource lifecycle is executed. The TRON package also provides a production-oriented
resource state machine, TronWeb chain driver, Stake 2.0 sizing, immutable action persistence
contracts, bounded policy helpers, unknown-state recovery, and an explicit process-local coordinator
for tests and development. TRON transaction signing now normalizes wallet recovery bytes for node
broadcast while the Approval validator accepts both standard encodings, and the chain driver handles
TronWeb's string account types plus successful system receipts that omit `receipt.result`.
