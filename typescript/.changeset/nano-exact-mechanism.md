---
"@bankofai/x402-nano": minor
---

Add `@bankofai/x402-nano`, an `exact` scheme mechanism for Nano (XNO) on `nano:mainnet`. The payer
publishes its own send block and sends `{ blockHash }`; the facilitator verifies it with one
`block_info` call and settlement records the hash without broadcasting anything.
