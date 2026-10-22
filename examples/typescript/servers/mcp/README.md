# TRON mcp server

Registers the TRON exact server with official @x402/mcp. Exposes free ping and paid get_weather tools over SSE on port 4023.

From `examples/typescript`:

```sh
cp .env-exact.example .env-exact
# Fill in the scenario configuration.
pnpm dev:mcp-server
```

Start `pnpm dev:facilitator` first; both MCP examples share `.env-exact`.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
