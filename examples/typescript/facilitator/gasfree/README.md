# GasFree facilitator (TRON `exact_gasfree`)

Verifies and settles TRON **GasFree** payments. Unlike the `exact` facilitator it
does **not** broadcast a raw TRON transaction — it forwards the signed TIP-712
permit to the **GasFree relayer API**, which pays the on-chain energy and submits.

- Scheme: `exact_gasfree` on `tron:3448148188`.
- Port `4032`.
- Key custody in `@bankofai/agent-wallet`; the TronWeb instance holds no key.

## Run

From `examples/typescript/`:

```bash
pnpm dev:gasfree-facilitator   # :4032
pnpm dev:gasfree-server        # :4031
pnpm dev:gasfree-client
```

## Env (`.env-gasfree`)

| Var | Purpose |
|---|---|
| `AGENT_WALLET_PRIVATE_KEY` | facilitator key (agent-wallet); issuer address + relayer-request signing |
| `TRON_GRID_API_KEY` | optional, raises TronGrid rate limits |
| `GASFREE_API_URL` | optional, override the Nile relayer base URL |
| `FACILITATOR_PORT` | defaults to `4032` |

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/verify` | verify a GasFree permit |
| POST | `/settle` | relay the permit through the GasFree API |
| GET | `/supported` | advertised scheme/network + extensions |
