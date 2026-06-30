# Upto resource server (EVM + TRON)

Express resource server that protects `GET /generate` behind the **`upto`**
scheme. The client signs a Permit2 authorization for up to a **maximum** amount
(`MAX_PRICE`); the route handler then decides the **real usage** for the request
and tells the middleware to settle only that much. This is usage-based billing:
authorize a ceiling once, charge actual usage per request.

Key-less: it advertises `accepts` (with `price` = the authorization ceiling) and
delegates verify/settle to the [facilitator](../../facilitator/upto/README.md)
over HTTP.

## Prerequisites

- Set the payout address(es) you want to accept:
  - `EVM_ADDRESS` → BSC (`eip155:97`), token USDC (Permit2)
  - `TRON_ADDRESS` → TRON Nile (`tron:nile`), token USDT (Permit2)
- A running upto facilitator (default `FACILITATOR_URL=http://localhost:4052`).

## Run

```bash
pnpm dev          # from this dir, or:
pnpm --filter @bankofai/x402-example-upto-server dev        # from repo root
```

Listens on `SERVER_PORT` (default **4051**). Start it **after** the facilitator
and **before** the client.

## How the partial settlement works

The route handler sets a response header before sending the body:

```ts
res.setHeader("Settlement-Overrides", JSON.stringify({ amount: "37.42%" }));
```

The payment middleware reads it, settles `37.42%` of the matched requirement's
amount (the authorized max), and strips the header from the client response. The
override `amount` accepts three formats: a **percent** (`"37.42%"`), raw **atomic
units** (`"1000"`), or a **dollar price** (`"$0.05"`). This example uses a random
percent so it stays asset-/decimal-agnostic across EVM and TRON.

The resolved amount must be **≤ the authorized maximum** — partial settlement is
the whole point of `upto`, and over-settling is rejected.

## Notes

- Both chains price in `"$"` form (the authorization ceiling, `MAX_PRICE`); the
  scheme maps it to the network's default asset (BSC USDC / TRON USDT, both
  registered in `@bankofai/x402-evm` / `@bankofai/x402-tron`).
- The server holds no signing key — only payout addresses.
