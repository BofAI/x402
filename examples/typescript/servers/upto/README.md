# TRON upto server

Protects GET /generate on port 4051. MAX_PRICE is the authorization ceiling; Settlement-Overrides selects the actual usage charge.

From `examples/typescript`:

```sh
cp .env-upto.example .env-upto
# Fill in the scenario configuration.
pnpm dev:upto-server
```

`TRON_NETWORK` selects the network and defaults to Nile. Ordinary Permit2 Approval requires payer TRX.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
