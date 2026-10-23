# TRON express server

Registers TRON exact with official @x402/express and protects GET /weather on port 4021. The server uses TRON_ADDRESS and never signs.

From `examples/typescript`:

```sh
cp .env-exact.example .env-exact
# Fill in the scenario configuration.
pnpm dev:server
```


See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
