# TRON fetch client

Pays GET /weather through official @x402/fetch using TRON exact Permit2.

From `examples/typescript`:

```sh
cp .env-exact.example .env-exact
# Fill in the scenario configuration.
pnpm dev:client
```

Configure an agent-wallet source for the selected TRON network. Wallet keys remain in the wallet provider.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
