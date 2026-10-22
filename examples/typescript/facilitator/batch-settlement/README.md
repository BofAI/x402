# TRON batch-settlement facilitator

Verifies TRON deposits and vouchers and submits deposit, claim, settlement, and refund transactions on port 4042.

From `examples/typescript`:

```sh
cp .env-batch.example .env-batch
# Fill in the scenario configuration.
pnpm dev:batch-facilitator
```

Configure an agent-wallet source for the selected TRON network. Wallet keys remain in the wallet provider.
`TRON_NETWORK` selects the network and defaults to Nile. Ordinary Permit2 Approval requires payer TRX.

See the [TRON scenario guide](../../README.md) for the other roles and prerequisites.
Use the [official examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript)
for generic framework and upstream-chain setup.
