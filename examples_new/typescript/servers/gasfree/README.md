# GasFree resource server (Express, TRON `exact_gasfree`)

Sells `GET /weather` behind a 402 challenge, settled on **TRON Nile** via the
**GasFree** scheme. Keyless — advertises `accepts` with the TRON payout address
and delegates verify/settle to the GasFree facilitator over HTTP.

- Scheme: `exact_gasfree` (TRON-only), token USDT, price `0.001 USDT`.
- Port `4031` (facilitator at `4032`).

## Run

From `examples_new/typescript/`:

```bash
pnpm dev:gasfree-facilitator   # :4032
pnpm dev:gasfree-server        # :4031
pnpm dev:gasfree-client
```

## Env (`.env-local`)

| Var | Purpose |
|---|---|
| `TRON_ADDRESS` | payout address (`T...`); required |
| `GASFREE_FACILITATOR_URL` | defaults to `http://localhost:4032` |
| `GASFREE_SERVER_PORT` | defaults to `4031` |
