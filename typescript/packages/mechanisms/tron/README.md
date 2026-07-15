# `@bankofai/x402-tron`

TRON (TVM) implementation of the x402 payment protocol — pay with TRC-20 tokens using the **Exact** scheme over TIP-712 signed authorizations.

## Installation

```bash
npm install @bankofai/x402-tron
```

## Overview

This package provides the three x402 mechanism roles for TRON, mirroring `@bankofai/x402-evm`:

- **Client** — applications that hold a wallet and create signed payment payloads
- **Facilitator** — processors that verify signatures and submit on-chain settlement
- **Server** — resource servers that price requests and build `PaymentRequirements`

It plugs into `@bankofai/x402-core` via the `tron:*` CAIP family — no core changes are required.

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
  network: "tron:0xcd8690dc",
});

// Facilitator: signs built settlement transactions for on-chain broadcast.
const facilitatorWallet: FacilitatorTronWallet = {
  getAddress: () => address,
  async signTransaction(transaction) {
    return tronWeb.trx.sign(transaction, privateKey);
  },
};
const facilitatorSigner = await createFacilitatorTronSigner(facilitatorWallet, {
  network: "tron:0xcd8690dc",
});
```

Both `createClientTronSigner` and `createFacilitatorTronSigner` are `async`
(they resolve the wallet address and build the TronWeb client from `network`).
Pass the wallet as the first argument and `{ network, rpcUrl?, apiKey? }` as
options — the factories build the TronWeb instance internally.

### Client

```ts
import { x402Client } from "@bankofai/x402-core/client";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/client";

const client = new x402Client();
registerExactTronScheme(client, { signer: clientSigner }); // registers on "tron:*"
```

### Server

```ts
import { x402ResourceServer } from "@bankofai/x402-core/server";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/server";

registerExactTronScheme(server); // prices to the network's default stablecoin
```

### Facilitator

```ts
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";

registerExactTronScheme(facilitator, { signer: facilitatorSigner, networks: "tron:0xcd8690dc" });
```

## Networks & on-chain dependencies

The `permit2` path depends on three on-chain contracts. Addresses live in `src/constants.ts`:

| Network | chainId (TIP-712) | Permit2 | x402ExactPermit2Proxy |
| --- | --- | --- | --- |
| `tron:0xcd8690dc` | 3448148188 | `TYQuuhGbEMxF7nZxUHV3uHJxAVVAegNU9h` | `TFGoaq2KjizijgjtkVxT7yjffW1A5T1j6F` |
| `tron:0x2b6653dc` | 728126428 | `TTJxU3P8rHycAyFY4kVtGNfmnMH4ezcuM9` | `TN49yaJmZMZoEdDCqjB4uPzQLHvYkGw95m` |
| `tron:0x94a9059e` | 2494104990 | — (no Permit2 deployment) | — |

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
