# Express resource server (EVM + TRON)

Protects `GET /weather` behind x402 payment. `src/index.ts` is **chain-agnostic**;
each chain's scheme registration + `accepts` entry lives in `src/chains/`.

## Keyless by design

A resource server never signs or holds funds. It only:

1. advertises `accepts` (price + `payTo` address) per enabled chain, and
2. delegates verify/settle to a facilitator over HTTP (`HTTPFacilitatorClient`).

So there is **no agent-wallet here** — just public payout addresses. A chain is
advertised only when its `*_ADDRESS` is set, so you can accept EVM-only,
TRON-only, or both.

## Run

```bash
# Start a facilitator first (see ../../facilitator/basic), then:
pnpm install            # from examples/typescript
pnpm dev                # or: pnpm --filter @bankofai/x402-example-server-express dev
```

Then pay it with the fetch client (`../../clients/fetch`).

## Networks

| Chain | Network | Tokens advertised | payTo env |
|---|---|---|---|
| EVM | `eip155:97` (BSC testnet) | DHLU (eip3009), USDC (permit2) | `EVM_ADDRESS` |
| TRON | `tron:3448148188` | USDT, USDD (permit2) | `TRON_ADDRESS` |

Tokens are configured per network in `src/chains/evm.ts` (`EVM_TOKENS`) and
`src/chains/tron.ts`. BSC USDC needs a one-time Permit2 approve, advertised via
the gas-sponsoring extension; DHLU (ERC-3009) needs none.
