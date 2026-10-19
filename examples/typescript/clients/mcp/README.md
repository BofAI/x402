# TRON mcp client

Registers the TRON exact client with official @x402/mcp and calls the paid get_weather tool.

From `examples/typescript`:

```sh
cp .env-exact.example .env-exact
# Fill in the scenario configuration.
pnpm dev:mcp-client
```

Configure an agent-wallet source for the selected TRON network. Wallet keys remain in the wallet provider.
Start `pnpm dev:facilitator` first; both MCP examples share `.env-exact`.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
