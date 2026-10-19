# TRON SDK examples

These examples demonstrate TRON support added by `@bankofai/x402-tron` and
`@bankofai/x402-tron-extensions`. They complement the
[official x402 examples](https://github.com/x402-foundation/x402/tree/main/examples/typescript),
which cover general Core, HTTP/MCP, framework, and upstream-chain integrations.

Only the two TRON packages are linked locally. Core, fetch, Express, and MCP integrations
come directly from official `@x402/*@2.28.0` packages. See the
[2.1 migration guide](../../docs/migrations/tron-2.1.md) for SDK migration requirements.

## Scenarios

Run each scenario's three commands in separate terminals from `examples/typescript`.

| Scenario | Environment template | Facilitator / server ports | Commands |
| --- | --- | --- | --- |
| Exact Permit2 | `.env-exact.example` | 4022 / 4021 | `dev:facilitator`, `dev:server`, `dev:client` |
| GasFree | `.env-gasfree.example` | 4032 / 4031 | `dev:gasfree-facilitator`, `dev:gasfree-server`, `dev:gasfree-client` |
| Upto | `.env-upto.example` | 4052 / 4051 | `dev:upto-facilitator`, `dev:upto-server`, `dev:upto-client` |
| Batch settlement | `.env-batch.example` | 4042 / 4041 | `dev:batch-facilitator`, `dev:batch-server`, `dev:batch-client` |
| Approval resource sponsorship | `.env-tron-sponsoring.example` | 4042 / 4041 | `dev:tron-sponsoring-facilitator`, `dev:tron-sponsoring-server`, `dev:tron-sponsoring-client` |

Batch and resource sponsorship share default ports; run them separately or change the ports.

```sh
pnpm install
pnpm --filter @bankofai/x402-tron --filter @bankofai/x402-tron-extensions build
cp .env-exact.example .env-exact
# Configure the wallet, payout address, and RPC settings in .env-exact.
pnpm dev:facilitator
# In separate terminals:
pnpm dev:server
pnpm dev:client
```

TRON Nile is the default test network (`tron:3448148188`). Configure `TRON_ADDRESS` and an
agent-wallet source for that exact network. Where supported, `PAY_TARGETS` selects a TRON
network and token, for example `tron:3448148188@USDT`; non-TRON targets are rejected.
Deprecated hexadecimal TRON network aliases remain accepted. Changing to mainnet uses real funds.

## TRON-specific behavior

- **Exact:** TIP-712 Permit2 payment with one-time TRC-20 Approval. Ordinary Approval requires
  payer TRX; the resource sponsorship scenario shows the sponsored alternative.
- **Upto:** authorize a maximum amount and settle the actual per-request usage.
- **Batch:** deposit once, pay with off-chain vouchers, then claim/settle/refund the channel.
- **GasFree:** sign a GasFree permit; the relayer charges token fees and pays chain energy.
  The payer's GasFree account must be activated and funded.
- **Resource sponsorship:** explicitly register the client/facilitator extension, configure a
  separate Resource Owner, and reconcile delegation and reclamation. Follow the
  [facilitator requirements](facilitator/tron-sponsoring/README.md), including production storage.

The bundled facilitators are local development examples. Services integrating the SDK must
supply their own authentication, durable pending storage, shared locking, and recovery policy.

## MCP and logging

The [MCP client](clients/mcp) and [server](servers/mcp) demonstrate registering TRON with official
`@x402/mcp`. They share `.env-exact` and `facilitator/basic`; run `pnpm dev:mcp-server`
(port 4023) and `pnpm dev:mcp-client`. `ping` is free; `get_weather` requires payment.
For generic MCP transport examples, use the official repository linked above.

[Logging](logging) demonstrates the TRON logger without keys or network I/O:
`pnpm dev:logging`. Official Core and extension packages retain their own logging behavior.

## Checks

```sh
pnpm -r typecheck
pnpm test
```

These checks do not broadcast transactions. Live-chain payment tests are separate from local
configuration and type checks.
