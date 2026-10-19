# TRON basic facilitator

Registers the TRON exact scheme with official Core and exposes /supported, /verify, and /settle on port 4022.

From `examples/typescript`:

```sh
cp .env-exact.example .env-exact
# Fill in the scenario configuration.
pnpm dev:facilitator
```

Configure an agent-wallet source for the selected TRON network. Wallet keys remain in the wallet provider.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
