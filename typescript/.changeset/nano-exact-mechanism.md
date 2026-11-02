---
"@bankofai/x402-nano": minor
---

Add `@bankofai/x402-nano`, an `exact` scheme mechanism for Nano (XNO) on `nano:mainnet`. The payer
publishes its own send block, committing to a payment secret in the block's `representative`, and
sends `{ blockHash, secret }`; the facilitator verifies it with one `block_info` call (confirmed send
to `payTo`, enough raw, bound to the secret, recent) and settlement records the hash and the
commitment in a required, durable store without broadcasting anything.
