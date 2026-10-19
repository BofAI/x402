# TRON batch-settlement server

Protects GET /weather on port 4041 and runs the TRON channel manager. It claims vouchers, settles payments, reclaims idle channel balances, and flushes on SIGINT.

From `examples/typescript`:

```sh
cp .env-batch.example .env-batch
# Fill in the scenario configuration.
pnpm dev:batch-server
```

`TRON_NETWORK` selects the network and defaults to Nile. Ordinary Permit2 Approval requires payer TRX.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
