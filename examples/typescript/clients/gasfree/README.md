# GasFree client (fetch, TRON `exact_gasfree`)

Pays a 402-protected resource on **TRON Nile** using the **GasFree** scheme — the
payer signs a TIP-712 permit and a relayer pays the on-chain energy, so the payer
needs **no TRX**.

- Scheme: `exact_gasfree` (TRON-only).
- Funds come from the payer's **GasFree custodial wallet**, not the main wallet.
- No one-time `approve` (unlike the permit2 `exact` flow): the signer only does
  `getAddress` + `signTypedData`.

## Run

From `examples/typescript/` (start the GasFree facilitator and server first):

```bash
pnpm dev:gasfree-facilitator   # :4032
pnpm dev:gasfree-server        # :4031
pnpm dev:gasfree-client
```

## Env (`.env-gasfree`)

| Var | Purpose |
|---|---|
| `AGENT_WALLET_PRIVATE_KEY` | payer key (agent-wallet) |
| `RESOURCE_URL` | defaults to `http://localhost:4031/weather` |
| `TRON_GRID_API_KEY` | optional, raises TronGrid rate limits |
| `GASFREE_API_URL` | optional, override the Nile relayer base URL |

> Preconditions: the payer's GasFree account on Nile must be **activated and
> funded** with the token (USDT). If not, settlement fails at the relayer.
