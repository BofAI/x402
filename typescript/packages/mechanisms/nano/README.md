# `@bankofai/x402-nano`

Nano (XNO) implementation of the x402 payment protocol for the **Exact** scheme. It sits beside
`@bankofai/x402-evm` and `@bankofai/x402-tron`: a server can list a Nano entry in `accepts[]` next
to its existing ones.

## How it differs from EVM and TRON

Nano has no token contracts, no gas and no third party that submits a transfer. The payer
publishes its own send block, which the network confirms in about a second, and hands over the
block hash:

```json
{ "blockHash": "87434F8041869A01C8F6F263B87972D7BA443A72E0A97D7A3FD0CCC2358FD6F9" }
```

- **Client** asks a wallet you supply to publish a send of exactly `amount` raw to `payTo`.
- **Facilitator** makes one `block_info` RPC call (`json_block: "true"`) and checks the block is
  confirmed, is a send (state `subtype: "send"` or a legacy `send` block), pays `payTo` (the
  `link` / `destination`, compared by public key; `block_account` is the payer), carries at least
  `amount` raw, and was first seen by the node within `maxTimeoutSeconds` (or
  `maxBlockAgeSeconds`).
- **Settle** broadcasts nothing. It re-runs the checks, records the hash so the block cannot pay
  twice, and returns the hash as `transaction`.
- **Server** prices in XNO (`"0.001 XNO"`) or raw (`{ amount, asset: "XNO" }`) and uses the
  `upfront` payment flow, so settlement (and the replay record) happens before the handler runs.

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

const rpc = createNanoRpcClient({ rpcUrl: "http://127.0.0.1:7076" }); // your own node
new x402Facilitator().register(NANO_MAINNET, new ExactNanoScheme({ rpc }));
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

- A published block is public. The first payload that presents a hash redeems it, so where it
  matters, give each request or buyer its own `payTo`.
- The default replay store is in memory. Pass a shared `usedBlocks` store when several facilitator
  processes serve the same `payTo`.
- `local_timestamp` is the node's own first-seen time. A node that bootstrapped the block reports
  `0`, which is treated as too old.

## Package exports

| Subpath | Contents |
| --- | --- |
| `@bankofai/x402-nano` | client `ExactNanoScheme`, RPC client, address and amount helpers, types, constants |
| `@bankofai/x402-nano/exact/client` | client scheme |
| `@bankofai/x402-nano/exact/server` | server scheme |
| `@bankofai/x402-nano/exact/facilitator` | facilitator scheme, replay store, error codes |
