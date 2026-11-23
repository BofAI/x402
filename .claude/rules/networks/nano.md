# Network: Nano

Mechanisms: `typescript/packages/mechanisms/nano` (`@bankofai/x402-nano`). **In-house, no upstream** — edit directly.

Identifier: `nano:mainnet` (`NANO_MAINNET`), CAIP family `nano:*`. Asset `XNO`, 30 decimals (1 XNO = 10^30 raw).

## When to use

Read before touching Nano address, amount or block-verification code.

## Key invariants

- The payer publishes its own send block; the payload is `{ blockHash }`. There is no facilitator signer and nothing to broadcast at settle.
- Verify uses one `block_info` call with `json_block: "true"`. The recipient is `contents.link` (state) or `contents.destination` (legacy). **`block_account` is the payer**, never the recipient. Compare accounts by public key so `nano_` and `xrb_` forms match.
- Amounts are `bigint` raw. Never round: refuse a 31st decimal, exponents and JS numbers.
- Settle records the hash in the replay store before returning success; the server flow is `upfront` so this happens before the handler.

## Testing

`mechanisms/nano/test/unit/**` — mocked `fetch` returning `block_info` bodies in the node's own shape. No network calls.
