---
"@bankofai/x402-tron": minor
"@bankofai/x402-tron-extensions": minor
---

Extract TRON resource sponsorship into the independently published extension package.
Move runtime, coordinator, policies, resource chain adapters, schema and Approval
validation out of the mechanism. Register the client and facilitator extension
factories explicitly with official Core 2.28.0. Retain wallet factories, payment
messages and public mechanism contracts, and expose general RPC configuration and
transaction tools. Move generic legacy extensions to a separate workspace location
while preserving their package name for callers that have not migrated.
