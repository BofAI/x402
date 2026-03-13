# @bankofai/x402-tron

TRON implementation of the x402 payment protocol using the **Exact** payment scheme. Supports both EIP-3009 style TransferWithAuthorization and Permit2 flows for TRC-20 tokens.

## Installation

```bash
pnpm install @bankofai/x402-tron @bankofai/x402-core
```

## Overview

This package provides components for handling x402 payments on the TRON blockchain:

- **Client** - For applications that need to make payments (using `ExactTronScheme`)
- **Facilitator** - For payment processors that verify and execute on-chain transactions (using `ExactTronFacilitatorScheme`)
- **Server** - For resource servers that accept payments and build payment requirements (using `ExactTronServerScheme`)

## Usage

### Client Setup

```typescript
import { x402Client } from "@bankofai/x402-core/client";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/client";

const client = new x402Client()
  .register("tron:*", new ExactTronScheme(tronSigner));
```

### Server Setup

```typescript
import { x402ResourceServer } from "@bankofai/x402-core/server";
import { ExactTronScheme } from "@bankofai/x402-tron/exact/server";

const server = new x402ResourceServer(facilitatorClient)
  .register("tron:*", new ExactTronScheme());
```

### Facilitator Setup

```typescript
import { x402Facilitator } from "@bankofai/x402-core/facilitator";
import { registerExactTronScheme } from "@bankofai/x402-tron/exact/facilitator";

const facilitator = new x402Facilitator();
registerExactTronScheme(facilitator, {
  signer: tronSigner,
  networks: ["tron:mainnet", "tron:nile"],
});
```

## Supported Networks

Uses [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/main/CAIPs/caip-2.md) identifiers:
- `tron:mainnet` - TRON Mainnet
- `tron:nile` - TRON Nile Testnet
- `tron:shasta` - TRON Shasta Testnet

## License

Apache-2.0
