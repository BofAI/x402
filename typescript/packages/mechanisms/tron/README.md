# `@bankofai/x402-tron`

TRON (TVM) implementation of the x402 payment protocol — pay with TRC-20 tokens using the **Exact** scheme over TIP-712 signed authorizations.

## Installation

```bash
npm install @bankofai/x402-tron @x402/core@2.28.0
```

## Overview

This package provides the three x402 mechanism roles for TRON, using official Core role interfaces:

- **Client** — applications that hold a wallet and create signed payment payloads
- **Facilitator** — processors that verify signatures and submit on-chain settlement
- **Server** — resource servers that price requests and build `PaymentRequirements`

It plugs into `@x402/core` via the `tron:*` CAIP family.

TRON network identifiers use decimal CAIP-2 references (`tron:728126428`, `tron:3448148188`, and
`tron:2494104990`). The SDK accepts the older hexadecimal forms as input aliases, while newly
created configuration and protocol output use the decimal identifiers.

### Fee behavior

None of the TRON schemes (`exact`, `upto`, `exact_gasfree`) advertise or collect
a facilitator service fee via the SDK public API. The deployed proxies transfer
exactly the payment amount. GasFree provider-driven fees (`transferFee`,
`activateFee`) are inherent to the relayer protocol and remain unchanged — they
are read from the relayer API, not configured via the SDK.

## Two transfer paths (and why TRON is effectively Permit2)

The exact scheme supports two `assetTransferMethod`s, selected via `extra.assetTransferMethod`:

| method | how | when |
| --- | --- | --- |
| `eip3009` | TIP-712 `TransferWithAuthorization` (TRON equivalent of EIP-3009) | only tokens that implement `transferWithAuthorization` |
| `permit2` | Permit2 `PermitWitnessTransferFrom` + `x402ExactPermit2Proxy` | **any TRC-20** — the universal path |

> ⚠️ Mainstream TRON stablecoins (**USDT, USDD**) do **not** implement `transferWithAuthorization`, so real payments use **`permit2`**. The code falls back to `eip3009` only when no method is specified; `shared/defaultAssets.ts` therefore marks the TRON stablecoins as `permit2`. See the design notes in `analysis-report/x402-Tron网络支持方案.md`.

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

```ts
import { TronWeb } from "tronweb";
import {
  createClientTronSigner,
  createFacilitatorTronSigner,
  type ClientTronWallet,
  type FacilitatorTronWallet,
} from "@bankofai/x402-tron";

const privateKey = process.env.TRON_PRIVATE_KEY!.replace(/^0x/, "");
const tronWeb = new TronWeb({ fullHost: "https://nile.trongrid.io" });
const address = TronWeb.address.fromPrivateKey(privateKey) as string;

// Client: signs TIP-712 typed data. The private key stays in your wallet —
// the SDK only sees the ClientTronWallet interface, never the raw key.
const clientWallet: ClientTronWallet = {
  getAddress: () => address,
  async signTypedData(args) {
    const sig = await tronWeb.trx._signTypedData(
      args.domain,
      args.types,
      args.message,
      privateKey,
    );
    return (sig.startsWith("0x") ? sig : `0x${sig}`) as `0x${string}`;
  },
};
const clientSigner = await createClientTronSigner(clientWallet, {
  network: "tron:3448148188",
});

// Facilitator: signs built settlement transactions for on-chain broadcast.
const facilitatorWallet: FacilitatorTronWallet = {
  getAddress: () => address,
  async signTransaction(transaction) {
    return tronWeb.trx.sign(transaction, privateKey);
  },
};
const facilitatorSigner = await createFacilitatorTronSigner(facilitatorWallet, {
  network: "tron:3448148188",
});
```

Both `createClientTronSigner` and `createFacilitatorTronSigner` are `async`
(they resolve the wallet address and build the TronWeb client from `network`).
Pass the wallet as the first argument and `{ network, rpcUrl?, apiKey? }` as
options — the factories build the TronWeb instance internally.

### Client

```ts
import { x402Client } from "@x402/core/client";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/client";

const client = new x402Client();
registerExactTronScheme(client, { signer: clientSigner }); // registers on "tron:*"
```

### Server

```ts
import { x402ResourceServer } from "@x402/core/server";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/server";

registerExactTronScheme(server); // prices to the network's default stablecoin
```

### Facilitator

```ts
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";

registerExactTronScheme(facilitator, { signer: facilitatorSigner, networks: "tron:3448148188" });
```

## Networks & on-chain dependencies

The `permit2` path depends on three on-chain contracts. Addresses live in `src/constants.ts`:

| Network | chainId (TIP-712) | Permit2 | x402ExactPermit2Proxy |
| --- | --- | --- | --- |
| `tron:3448148188` | 3448148188 | `TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h` | `TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F` |
| `tron:728126428` | 728126428 | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | `TN49yaJmZMZoEdDCqjB4uPzQLHvYkGw95m` |
| `tron:2494104990` | 2494104990 | `TJMkP7a3ucTMkvi17p7ChhTCw6zriFX3tg` | `TGZkC38n14f2GpBWPMQLF2BpmcpWW3QNhg` |

> ⚠️ Mainnet uses real funds. The configured Permit2 and
> `x402ExactPermit2Proxy` addresses are the deployed mainnet contracts; verify
> them against the current release configuration before production use. The
> proxy `PERMIT2()` immutable must equal the configured Permit2 address, and its
> `WITNESS_TYPEHASH` must match the 2-field witness.

## Testing

### Unit (offline, no keys)

```bash
pnpm --filter @bankofai/x402-tron test
```

The suite is fully offline (no network, no keys):

- `permit2-digest.test.ts` — reproduces the exact on-chain Permit2 digest and recovers the signer two independent ways (the facilitator verify path and a manual contract-style reconstruction), guaranteeing TIP-712 hashing matches the deployed proxy.
- `gasfree-digest.test.ts` / `gasfree-flow.test.ts` — GasFree TIP-712 sign↔verify round-trip plus client/facilitator term-validation and settle flow against a mocked relayer.
- `tokens.test.ts`, `selection.test.ts`, `signer-wallet.test.ts` — token registry, token selection / balance filtering, and the ClientTronWallet abstraction.

## Notes & caveats

- **Addresses** are normalized to `0x` hex for TIP-712 signing and converted as needed; TRON Base58 (`T…`) and hex (`41…`) inputs are both accepted (`src/utils.ts`).
- **Receipts**: TRON has no instant receipt — the facilitator signer polls `getTransactionInfo` (gated on `blockNumber`, 120s deadline) and tolerates transient/rate-limit errors. A TronGrid API key speeds this up.
- **EIP-1153**: the deployed proxies use a transient-storage reentrancy guard; deploy only on TVM chains that support it (verified working on Nile).
- **Gas**: settlement consumes energy/TRX from the facilitator account; the payer needs a one-time Permit2 approval per token.


## Official Core migration (M1)

This candidate pins the peer dependency `@x402/core` to `2.28.0`. Use official
`@x402/fetch`, `@x402/axios`, `@x402/express`, or other official integration packages
with a compatible Core version. Existing payment message formats and the four
TRON schemes are retained.

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

This signature-only example supports authorization creation. Balance checks,
channel recovery and sponsored Approval preparation need `readContract`.
Permit2 allowance must already be sufficient or the application must provide an
`ensureAllowance` implementation. Automatic approve additionally needs transaction
signing. No allowance capability means the application manages approval itself.

Agent Wallet users can retain their wallet object and factory calls:

```ts
import { createClientTronSigner, createFacilitatorTronSigner } from "@bankofai/x402-tron";

const payer = await createClientTronSigner(wallet, {
  network: "tron:3448148188",
  rpcUrl,
});
const settlement = await createFacilitatorTronSigner(settlementWallet, {
  network: "tron:3448148188",
  rpcUrl,
  permissionId: 2,
});
```

The package does not install Agent Wallet at runtime. Offline interoperability tests
exercise Agent Wallet 2.4.0 with a local RPC fixture, including genuine signatures,
first approve, settlement permissions and pre-signed Approval validation.

Logging now belongs to the TRON package:

```ts
import { setLogger, noopLogger } from "@bankofai/x402-tron";
setLogger(noopLogger);
```

Wallet structural types are exported from the package root. Extension authors can
import the key, structural contracts and context helpers from
`@bankofai/x402-tron/exact/extensions`. Resource runtime is published separately as `@bankofai/x402-tron-extensions`;
service migration and testnet execution remain M3. Offline tests do not constitute
real-chain or durable-recovery acceptance.

Verify independent package consumption after building:

```bash
pnpm --filter @bankofai/x402-tron build
pnpm --filter @bankofai/x402-tron test:consumer
```

The consumer check installs the packed artifact in a temporary project, compiles
strict NodeNext ESM and CommonJS fixtures with `skipLibCheck: false`, runs a payment
through official Core in both formats and loads every public entrypoint. It rejects
runtime dependency trees containing old Core or Agent Wallet.


## Resource extension migration (M2)

Install the matching `@bankofai/x402-tron-extensions` candidate and explicitly register
its client and facilitator factories. Resource runtimes, coordinators, policy/chain
adapters and their types have moved out of this package's root exports. Use the
extension root instead. Ordinary payments require only this package and official Core.
The mechanism retains `/exact/extensions` contracts and `/rpc`, `/transactions` tools;
it does not depend on the resource extension.
