---
"@bankofai/x402-extensions": minor
"@bankofai/x402-tron": minor
---

Added the `trc20ApprovalResourceSponsoring` Extension for TRON `exact + Permit2` payments. Resource
Servers can advertise the canonical version 1 schema, Clients can attach a fully signed but
unbroadcast TRC-20 Approval, and Facilitators can register a resource-sponsoring runtime. The TRON
mechanism strictly decodes and validates the signed protobuf and binds it to the Permit2 payment
before any resource lifecycle is executed.
