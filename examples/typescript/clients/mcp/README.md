# MCP client — dual-chain (BSC testnet + TRON Nile)

Connects to an MCP server over SSE and calls its tools. On a 402, the SDK pays
automatically using whichever registered scheme matches the server's offered
network — **BSC testnet** (`eip155:97`) or **TRON Nile** (`tron:0xcd8690dc`).

Both chains are registered in one `createx402MCPClient({ schemes })` call; the
payment-selection pipeline filters by the offered network and picks a match. Each
chain registers only when its agent-wallet resolves (`src/chains/`), so the client
runs EVM-only, TRON-only, or both. Key custody stays in `@bankofai/agent-wallet`.

## Run

Shares `.env-exact` with the `exact` trio (`cp .env-exact.example .env-exact`):

```bash
pnpm dev:facilitator     # facilitator/basic on :4022   (terminal 1)
pnpm dev:mcp-server      # MCP server on :4023           (terminal 2)
pnpm dev:mcp-client      # this client                   (terminal 3)
```

Env (from `.env-exact`): `AGENT_WALLET_PRIVATE_KEY` (one key, both chains),
optional `TRON_GRID_API_KEY`. MCP-specific: `MCP_SERVER_URL` (default
`http://localhost:4023`).

## What it does

1. Lists tools.
2. Calls `ping` (free — no payment).
3. Calls `get_weather` — pays on whichever chain the server offered and this
   client supports, then prints the settlement tx.
