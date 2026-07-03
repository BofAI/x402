# MCP server — dual-chain (BSC testnet + TRON Nile)

An MCP server whose `get_weather` tool is gated behind x402 payment, accepting
**both** BSC testnet (`eip155:97`) and TRON Nile (`tron:0xcd8690dc`) at once. A 402
challenge offers every enabled chain; the client pays on whichever it supports.
`ping` is free.

Keyless: the server advertises `accepts` and delegates verify/settle to a
facilitator over HTTP. Per-chain setup is in `src/chains/`, each gated on its
payout address — run EVM-only, TRON-only, or both.

## Run

Shares `.env-exact` with the `exact` trio (`cp .env-exact.example .env-exact`):

```bash
# 1. Start the dual-chain facilitator (separate terminal)
pnpm dev:facilitator                 # facilitator/basic on :4022

# 2. Start this MCP server
pnpm dev:mcp-server                  # SSE on :4023

# 3. Call it
pnpm dev:mcp-client
```

Env (from `.env-exact`): `EVM_ADDRESS` (BSC payout), `TRON_ADDRESS` (TRON payout),
`FACILITATOR_URL` (default `http://localhost:4022`). MCP-specific:
`MCP_SERVER_PORT` (default `4023`).

## Tokens

- **BSC testnet**: DHLU (ERC-3009) — gasless, no approve, no extension.
- **TRON Nile**: USDT + USDD (permit2) — the TRON client auto-broadcasts the
  one-time `approve(Permit2)`.

To also accept a permit2 EVM token (e.g. BSC USDC), add the ERC-20 approval
gas-sponsoring extension — see `servers/express`.
