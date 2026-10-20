# `@bankofai/x402-tron`

TRON payment schemes for official `@x402/core`: `exact`, `upto`, `batch-settlement`, and `exact_gasfree`. For upgrading from 2.0, see the [migration guide](../../../../docs/migrations/tron-2.1.md).

## Installation

```sh
npm install @x402/core@2.28.0 @bankofai/x402-tron@2.1.0-beta.3
# Optional resource sponsorship; use the matching mechanism version
npm install @bankofai/x402-tron-extensions@2.1.0-beta.3
```

Use official HTTP/MCP integration packages with the same Core version.

## Overview

This package provides the three x402 mechanism roles for TRON, using official Core role interfaces:

- **Client** — applications that hold a wallet and create signed payment payloads
- **Facilitator** — processors that verify signatures and submit on-chain settlement
- **Server** — resource servers that price requests and build `PaymentRequirements`

It plugs into `@x402/core` via the `tron:*` CAIP family.

TRON network identifiers use decimal CAIP-2 references (`tron:728126428`, `tron:3448148188`, and `tron:2494104990`). The SDK accepts the older hexadecimal forms as input aliases, while newly created configuration and protocol output use the decimal identifiers.

### Fee behavior

None of the TRON schemes (`exact`, `upto`, `exact_gasfree`) advertise or collect a facilitator service fee via the SDK public API. The deployed proxies transfer exactly the payment amount. GasFree provider-driven fees (`transferFee`, `activateFee`) are inherent to the relayer protocol and remain unchanged — they are read from the relayer API, not configured via the SDK.

## Two transfer paths (and why TRON is effectively Permit2)

The exact scheme supports two `assetTransferMethod`s, selected via `extra.assetTransferMethod`:

| method | how | when |
| --- | --- | --- |
| `eip3009` | TIP-712 `TransferWithAuthorization` (TRON equivalent of EIP-3009) | only tokens that implement `transferWithAuthorization` |
| `permit2` | Permit2 `PermitWitnessTransferFrom` + `x402ExactPermit2Proxy` | **any TRC-20** — the universal path |

> ⚠️ Mainstream TRON stablecoins (**USDT, USDD**) do **not** implement `transferWithAuthorization`, so real payments use **`permit2`**. The code falls back to `eip3009` only when no method is specified; `shared/defaultAssets.ts` therefore marks the TRON stablecoins as `permit2`. See the [migration guide](../../../../docs/migrations/tron-2.1.md) for integration requirements.

### Exact witness shape

The `permit2` path binds the destination with a Permit2 **witness**. For the exact scheme the witness is **2-field**, matching the deployed `x402ExactPermit2Proxy`:

```
Witness(address to, uint256 validAfter)
```

The client TIP-712 type, the proxy `settle` ABI, and the on-chain `WITNESS_TYPEHASH` must stay in sync — `test/unit/permit2-digest.test.ts` enforces this. (The `upto` proxy uses a 3-field witness with a `facilitator` field; this section describes the `exact` witness only.)

## Package exports

| Subpath | Contents |
| --- | --- |
| `@bankofai/x402-tron` | client `ExactTronScheme`, `registerExactTronScheme`, signers, types, constants, utils |
| `@bankofai/x402-tron/exact/client` | client scheme + register + Permit2 helpers |
| `@bankofai/x402-tron/exact/server` | server scheme + register |
| `@bankofai/x402-tron/exact/facilitator` | facilitator scheme + register |
| `@bankofai/x402-tron/upto/client` | upto client scheme + register + Permit2 helpers |
| `@bankofai/x402-tron/upto/server` | upto server scheme + register |
| `@bankofai/x402-tron/upto/facilitator` | upto facilitator scheme + register |
| `@bankofai/x402-tron/gasfree/client` | exact_gasfree client scheme + register |
| `@bankofai/x402-tron/gasfree/server` | exact_gasfree server scheme + register |
| `@bankofai/x402-tron/gasfree/facilitator` | exact_gasfree facilitator scheme + register |
| `@bankofai/x402-tron/batch-settlement/*` | batch-settlement client/server/facilitator |

## Usage

### Signers

For an existing Agent Wallet configuration, install the optional wallet integration:

```sh
npm install @bankofai/agent-wallet@3.0.0
```

```ts
import { resolveWallet, type Wallet, type Eip712Capable } from "@bankofai/agent-wallet";
import { createClientTronSigner, createFacilitatorTronSigner } from "@bankofai/x402-tron";

const network = "tron:3448148188";
const payerWallet = (await resolveWallet({ network, walletId: "tron_client" })) as Wallet &
  Eip712Capable;
if (typeof payerWallet.signTypedData !== "function") {
  throw new Error("The payer wallet must support TIP-712 signing");
}
const settlementWallet = await resolveWallet({ network, walletId: "tron_facilitator" });

const clientSigner = await createClientTronSigner(payerWallet, { network });
const facilitatorSigner = await createFacilitatorTronSigner(settlementWallet, {
  network,
  permissionId: 2,
});
```

Both factories are asynchronous. Pass the wallet first and `{ network, rpcUrl?, apiKey? }` second. The wallet signs; the SDK builds its RPC client without a private key. Custom wallets can implement the structural `ClientTronWallet` or `FacilitatorTronWallet` contract instead.

### Client

```ts
import { x402Client } from "@x402/core/client";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/client";

const client = new x402Client();
registerExactTronScheme(client, { signer: clientSigner }); // registers on "tron:3448148188"
```

### Server

```ts
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/server";

const facilitatorClient = new HTTPFacilitatorClient({ url: process.env.FACILITATOR_URL! });
const server = new x402ResourceServer(facilitatorClient);
registerExactTronScheme(server); // prices to the network's default stablecoin
```

### Facilitator

```ts
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";

const facilitator = new x402Facilitator();
registerExactTronScheme(facilitator, { signer: facilitatorSigner, networks: "tron:3448148188" });
```

## Networks & on-chain dependencies

The `permit2` path uses Permit2 and the x402 Exact Permit2 proxy. Addresses live in `src/constants.ts`:

| Network | chainId (TIP-712) | Permit2 | x402ExactPermit2Proxy |
| --- | --- | --- | --- |
| `tron:3448148188` | 3448148188 | `TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h` | `TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F` |
| `tron:728126428` | 728126428 | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | `TN49yaJmZMZoEdDCqjB4uPzQLHvYkGw95m` |
| `tron:2494104990` | 2494104990 | `TJMkP7a3ucTMkvi17p7ChhTCw6zriFX3tg` | `TGZkC38n14f2GpBWPMQLF2BpmcpWW3QNhg` |

> ⚠️ Mainnet uses real funds. The configured Permit2 and `x402ExactPermit2Proxy` addresses are the deployed mainnet contracts; verify them against the current release configuration before production use. The proxy `PERMIT2()` immutable must equal the configured Permit2 address, and its `WITNESS_TYPEHASH` must match the 2-field witness.

## Testing

### Unit (offline, no keys)

```bash
pnpm --filter @bankofai/x402-tron test
```

The suite is fully offline (no network, no keys):

- `permit2-digest.test.ts` — reproduces the exact on-chain Permit2 digest and recovers the signer two independent ways (the facilitator verify path and a manual contract-style reconstruction), guaranteeing TIP-712 hashing matches the deployed proxy.
- `gasfree-digest.test.ts` / `gasfree-flow.test.ts` — GasFree TIP-712 sign↔verify round-trip plus client/facilitator term-validation and settle flow against a mocked relayer.
- `tokens.test.ts`, `selection.test.ts`, `signer-wallet.test.ts` — token registry, token selection / balance filtering, and the ClientTronWallet abstraction.

### Package consumers

Verify independent package consumption after building:

```bash
pnpm --filter @bankofai/x402-tron build
pnpm --filter @bankofai/x402-tron test:consumer
```

The consumer check installs the packed artifact in a temporary project, compiles strict NodeNext ESM and CommonJS fixtures with `skipLibCheck: false`, runs a payment through official Core in both formats and loads every public entrypoint. It rejects runtime dependency trees containing old Core or Agent Wallet.

## Notes & caveats

- **Addresses** are normalized to `0x` hex for TIP-712 signing and converted as needed; TRON Base58 (`T…`) and hex (`41…`) inputs are both accepted (`src/utils.ts`).
- **Receipts**: the facilitator signer polls FullNode `wallet/gettransactioninfobyid` for a packed receipt. The default wait is 90 seconds, configurable through `confirmationTimeoutMs`; indeterminate receipts return `settlement_pending`.
- **EIP-1153**: the deployed proxies use a transient-storage reentrancy guard; deploy only on TVM chains that support it (verified working on Nile).
- **Gas**: settlement consumes energy/TRX from the facilitator account; the payer needs a one-time Permit2 approval per token.
- **Upto preflight**: failed or malformed required allowance/balance reads return `chain_read_failed` before settlement broadcast.

## Signer capabilities

A client may supply only the signing capabilities its payment path needs:

```ts
import { x402Client } from "@x402/core/client";
import { ExactTronScheme, toClientTronSigner } from "@bankofai/x402-tron";

const signer = toClientTronSigner({
  address,
  signTypedData: args => signingService.signTypedData(args),
});
const client = new x402Client().register("tron:3448148188", new ExactTronScheme(signer));
```

This signature-only example supports authorization creation. Balance checks, channel recovery and sponsored Approval preparation need `readContract`. Permit2 allowance must already be sufficient or the application must provide an `ensureAllowance` implementation. Automatic approve additionally needs transaction signing. No allowance capability means the application manages approval itself.

Wallet structural types are exported from the package root. Public contracts and context helpers for extension authors are available from `@bankofai/x402-tron/exact/extensions`. The SDK has no Agent Wallet runtime dependency.

## Logging

Configure logging through the TRON package:

```ts
import { setLogger, noopLogger } from "@bankofai/x402-tron";
setLogger(noopLogger);
```

## Resource sponsorship

Install the matching `@bankofai/x402-tron-extensions` version and register its client and facilitator extensions. See the [resource extension guide](../../extensions/README.md) for registration and runtime configuration.

## Spend controls

Official Core's resolved `maxAmountPerPayment` applies to actual batch deposit amounts and GasFree `value + maxFee` before signing. A default batch deposit above the cap is rejected; choose a smaller `depositStrategy` (at least the required top-up) or configure an appropriate cap. Voucher cumulative totals are not new deposit amounts.

## Pending settlement recovery

The official Core retries a pending settlement once when a transaction ID is known. Facilitator schemes retain and reconcile the original transaction before verification or broadcasting again. Batch snapshots and GasFree relayer traces survive these retries.

The default pending store covers a single process and never expires uncertain transactions. Production restarts or multiple facilitator replicas require a durable shared `TronPendingSettlementStore`, exported from each facilitator role entrypoint. Inject it via `pendingSettlementStore` in the scheme options. Its `withLock` must exclude all replicas for the full callback, including receipt waiting. See the migration guide for constructor positions, store-failure handling and the separate resource coordinator requirement.
