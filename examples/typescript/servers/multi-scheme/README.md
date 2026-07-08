# Multi-scheme resource server (EVM `exact` + TRON `exact`/`exact_gasfree`)

Protects `GET /weather` behind x402 payment and accepts **both TRON schemes on the
same network** — `exact` (permit2, payer pays TRX energy) and `exact_gasfree`
(relayer pays energy, payer needs no TRX) — alongside EVM `exact`. The resource
server is keyless: it advertises `accepts` and delegates verify/settle to two
facilitators over HTTP, routing each payment by `(network, scheme)`.

## Why two schemes on one server

The resource server keys registered schemes by `(network, scheme)`, so `exact`
and `exact_gasfree` coexist on `tron:0xcd8690dc` without conflict. The client
chooses which scheme to pay by honoring one of the advertised `accepts` entries
in the 402 challenge.

## Two facilitators

This server wires **two** existing facilitators (run both first):

- **basic** (`:4022`) — settles `exact` (EVM + TRON permit2). See `../../facilitator/basic`.
- **gasfree** (`:4032`) — settles `exact_gasfree` (TRON relayer). See `../../facilitator/gasfree`.

On startup the resource server fetches `/supported` from each and builds a
`(network, scheme) → facilitator` dispatch table; payments land at the right one.

## Run

```bash
# Start both facilitators (from examples/typescript):
pnpm dev:facilitator          # :4022  (exact)
pnpm dev:gasfree-facilitator  # :4032  (exact_gasfree)

# Then the multi-scheme server:
pnpm dev:multi-scheme-server # :4061
```

Pay it with a fetch/gasfree client pointed at `http://localhost:4061/weather`.

## Networks

| Chain | Network | Schemes advertised | Tokens | payTo env |
|---|---|---|---|---|
| EVM | `eip155:97` (BSC testnet) | `exact` | DHLU (eip3009), USDC/USDT (permit2) | `EVM_ADDRESS` |
| TRON | `tron:0xcd8690dc` | `exact`, `exact_gasfree` | USDT, USDD (`exact`); USDT (`exact_gasfree`) | `TRON_ADDRESS` |

EVM tokens are configured in `src/chains/evm.ts` (`EVM_TOKENS`); TRON schemes in
`src/chains/tron.ts`. BSC USDC/USDT need a one-time Permit2 approve, advertised
via the gas-sponsoring extension; DHLU (ERC-3009) and GasFree need none.

## Env (`.env-multi-scheme`)

| Var | Purpose |
|---|---|
| `EVM_ADDRESS` | EVM payout address; omit to disable EVM |
| `TRON_ADDRESS` | TRON payout address (`T...`); omit to disable TRON |
| `EXACT_FACILITATOR_URL` | basic facilitator (defaults `http://localhost:4022`) |
| `GASFREE_FACILITATOR_URL` | gasfree facilitator (defaults `http://localhost:4032`) |
| `SERVER_PORT` | defaults to `4061` |
