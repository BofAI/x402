# `@x402/tron`

TRON implementation of the x402 `exact` payment scheme for signed TRC-20 transfers.

## Scope

- x402 version 2
- TRC-20 `transfer(address,uint256)` transactions
- Client signs and pays Energy/Bandwidth fees
- Facilitator verifies, broadcasts, and waits for confirmation
- Single-signature accounts only in the initial implementation

TRON does not currently have a registered Chain Agnostic Namespaces profile. This package uses the project network identifiers `tron:mainnet`, `tron:shasta`, and `tron:nile`.

## Client

```typescript
import { TronWeb } from "tronweb";
import { x402Client } from "@x402/core/client";
import { ExactTronScheme, createClientTronSigner } from "@x402/tron";

const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
const signer = createClientTronSigner(tronWeb, process.env.TRON_PRIVATE_KEY!);

const client = new x402Client();
client.register("tron:*", new ExactTronScheme(signer));
```

## Server

```typescript
import { x402ResourceServer } from "@x402/core/server";
import { ExactTronScheme } from "@x402/tron/exact/server";

const server = new x402ResourceServer(facilitatorClient);
server.register("tron:*", new ExactTronScheme());
```

Dollar-string pricing defaults to mainnet USDT on `tron:mainnet`. Testnets require an explicit `{ amount, asset }` or a configured `defaultAssets` entry.

## Facilitator

```typescript
import { TronWeb } from "tronweb";
import { x402Facilitator } from "@x402/core/facilitator";
import { createFacilitatorTronClient } from "@x402/tron";
import { ExactTronScheme } from "@x402/tron/exact/facilitator";

const tronWeb = new TronWeb({ fullHost: "https://api.trongrid.io" });
const tronClient = createFacilitatorTronClient({
  "tron:mainnet": tronWeb,
});

const facilitator = new x402Facilitator();
facilitator.register("tron:mainnet", new ExactTronScheme(tronClient));
```

The facilitator does not need a TRON private key for this flow because it only broadcasts a transaction already signed by the payer.
