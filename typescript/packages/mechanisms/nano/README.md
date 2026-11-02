# `@bankofai/x402-nano`

Nano (XNO) implementation of the x402 payment protocol for the **Exact** scheme. It sits beside
`@bankofai/x402-evm` and `@bankofai/x402-tron`: a server can list a Nano entry in `accepts[]` next
to its existing ones.

## How it differs from EVM and TRON

Nano has no token contracts, no gas and no third party that submits a transfer. The payer
publishes its own send block, which the network confirms in about a second, and hands over the
block hash and a payment secret:

```json
{
  "blockHash": "87434F8041869A01C8F6F263B87972D7BA443A72E0A97D7A3FD0CCC2358FD6F9",
  "secret": "abababababababababababababababababababababababababababababababab"
}
```

- **Client** draws a random secret and asks a wallet you supply to publish a send of exactly
  `amount` raw to `payTo` whose `representative` is the order commitment (below).
- **Facilitator** makes one `block_info` RPC call (`json_block: "true"`) and checks the block is
  confirmed, is a send (state `subtype: "send"` or a legacy `send` block), pays `payTo` (the
  `link` / `destination`, compared by public key; `block_account` is the payer), carries at least
  `amount` raw, carries the commitment to the presented secret as its `representative`, and was
  first seen by the node within `maxTimeoutSeconds` (or `maxBlockAgeSeconds`).
- **Settle** broadcasts nothing. It re-runs the checks, records the hash and the commitment (each
  unique) so the block cannot pay twice and one payment cannot be credited twice, and returns the
  hash as `transaction`.
- **Server** prices in XNO (`"0.001 XNO"`) or raw (`{ amount, asset: "XNO" }`) and uses the
  `upfront` payment flow, so settlement (and the replay record) happens before the handler runs.

## Why a block is bound to the payer (order commitment)

A Nano block has no memo and its hash is public. If the facilitator accepted "any confirmed send to
`payTo` of enough", whoever watches the ledger could present somebody else's hash and take the
resource. So the send block carries a commitment in its `representative` field, signed by the paying
key:

```
representative = nano_ account of SHA256("xno-binding/v1/rep|" + secret + "|" + payTo + "|" + amount)
```

This is option C of the
[XNO payment-to-order binding standard](https://github.com/dhyabi2/xno-call-binding/blob/main/docs/BINDING-STANDARD.md)
with the payer's secret as the order id (`nanoOrderCommitment`, test vector in
`test/unit/binding.test.ts`). The ledger shows only the hash of the secret; the payload reveals the
secret to the facilitator, which recomputes the commitment from the requirements and compares it with
the block. A stranger who read the block cannot redeem it, and a block committed to a cheaper price
does not pay a dearer one. The wallet must therefore let the caller set the representative of the
send block (`ClientNanoWallet.send` receives it as `representative`); legacy send blocks have no
representative and are refused.

## Identifiers and amounts

| Item | Value |
| --- | --- |
| Network | `nano:mainnet` (`NANO_MAINNET`) |
| CAIP family | `nano:*` |
| Asset | `XNO` |
| Decimals | 30 (1 XNO = 10^30 raw) |
| Addresses | `nano_` or legacy `xrb_`, base32 with a blake2b-40 checksum |

Amounts are `bigint` raw on every path. `xnoToRaw` refuses numbers, exponents, signs and a 31st
decimal instead of rounding; `parseRaw` accepts only plain integer strings up to 2^128 - 1.

## Usage

```ts
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { ExactNanoScheme } from "@bankofai/x402-nano/exact/facilitator";
import { createNanoRpcClient, NANO_MAINNET } from "@bankofai/x402-nano";

import Database from "better-sqlite3"; // or node:sqlite's DatabaseSync; the package loads neither
import { SqliteNanoUsedBlockStore } from "@bankofai/x402-nano";

const rpc = createNanoRpcClient({ rpcUrl: "http://127.0.0.1:7076" }); // your own node
const db = new Database("nano-used-blocks.db");
db.pragma("synchronous = FULL");
new x402Facilitator().register(
  NANO_MAINNET,
  new ExactNanoScheme({ rpc, usedBlocks: new SqliteNanoUsedBlockStore(db) }),
);
```

```ts
import { x402Client } from "@bankofai/x402-core/client";
import { ExactNanoScheme } from "@bankofai/x402-nano/exact/client";

const client = new x402Client()
  .register("nano:mainnet", new ExactNanoScheme(wallet)) // wallet.send(...) => block hash
  .setSpendControls({
    allowedAssets: [{ network: "nano:mainnet", asset: "XNO", maxAmountPerPayment: "10" + "0".repeat(29) }],
  });
```

XNO is not a USD default asset, so the client must opt in through `spendControls.allowedAssets`;
the cap is in raw.

## Limits to know

- The commitment binds a block to its payer, `payTo` and price, not to one HTTP request: the same
  paid secret cannot be reused (each commitment pays once), but a payer who wants a per-request
  record should use a fresh secret each time, which the client scheme does. Where a per-resource
  guarantee is needed, give each resource its own `payTo`.
- There is no default replay store. `usedBlocks` is required and must report `persistent: true`
  (`SqliteNanoUsedBlockStore` is the reference; implement `NanoUsedBlockStore` over a shared database
  or `SET NX` for several machines, `add` must be atomic). `allowInMemoryUsedBlocks: true` exists for
  tests and demos only.
- `local_timestamp` is the node's own first-seen time. A node that bootstrapped the block reports
  `0`, which is treated as too old.

## Package exports

| Subpath | Contents |
| --- | --- |
| `@bankofai/x402-nano` | client `ExactNanoScheme`, RPC client, address and amount helpers, types, constants |
| `@bankofai/x402-nano/exact/client` | client scheme |
| `@bankofai/x402-nano/exact/server` | server scheme |
| `@bankofai/x402-nano/exact/facilitator` | facilitator scheme, replay store, error codes |
