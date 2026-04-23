# Testnet scenarios

These scenarios hit **real testnets** (BSC testnet, TRON Nile) and settle
**real on-chain transactions** through [`examples.facilitator`](../../../examples/facilitator/). They are the counterpart to the mock scenarios under [`../`](../) and the same test client + resource server code drives both.

| Scenario | Network | Scheme | Settlement |
|---|---|---|---|
| [`exact_testnet/`](exact_testnet/) | `eip155:97` (BSC testnet) | `exact` (ERC-3009) | single tx (transferWithAuthorization) |
| [`exact_permit_testnet/`](exact_permit_testnet/) | `eip155:97` | `exact_permit` (EIP-2612) | permit + transferFrom |
| [`exact_gasfree_testnet/`](exact_gasfree_testnet/) | `tron:nile` | `exact_gasfree` (TIP-712) | GasFree relayer submits |

## Running locally

1. Copy [`.env.example`](../../../.env.example) to `.env` and fill in the
   required keys / addresses / API URLs for whichever scenarios you want to
   run. Scenarios with any required env var left blank are **skipped**, not
   failed.
2. Load `.env` into your shell:
   ```bash
   set -a; source .env; set +a
   ```
3. Run the suite:
   ```bash
   ./e2e/scenarios/run_testnet.sh
   ```

## Running in CI

The [`nightly_testnet.yml`](../../../.github/workflows/nightly_testnet.yml)
workflow runs these scenarios nightly against GitHub Secrets. A manual
`workflow_dispatch` trigger is also available.

## Architecture

```
┌─ test client ────┐  ┌─ resource server ──┐  ┌─ example facilitator ──┐  ┌─ testnet ─┐
│ e2e/clients/     │─▶│ e2e/servers/       │─▶│ examples/facilitator/  │─▶│ BSC / TRON │
│ real signature   │  │ @x402_protected    │  │ real settlement signer │  │ real chain │
└──────────────────┘  └────────────────────┘  └────────────────────────┘  └───────────┘
```

- The same `test_client` and `resource_server` used by the mock suite.
- The facilitator is `examples/facilitator/` (FastAPI wrapper over
  `X402Facilitator`) — not the mock. It holds a real private key and submits
  real on-chain transactions.
- The tx hash is dynamic, so scenarios assert with `@json_match` (regex /
  key-presence) instead of `@json_diff` (exact equality used by mocks).

## Adding a new testnet scenario

1. Create `testnet/<name>/config.json` following the pattern in
   [`exact_testnet/config.json`](exact_testnet/config.json).
2. Add `<name>` to the `names`/`required` arrays in
   [`../run_testnet.sh`](../run_testnet.sh) with the env vars it needs.
3. If it needs secrets that aren't already in the nightly workflow, update
   [`../../../.github/workflows/nightly_testnet.yml`](../../../.github/workflows/nightly_testnet.yml).

## Why not just reuse `@json_diff`?

Real on-chain transactions return a fresh tx hash every run, so strict
equality against a committed `expected_payment_response.json` would fail.
`@json_match` supports both exact literal matches (for status codes,
booleans, network IDs) and regex matches (for dynamic fields like tx
hashes). It's intentionally simple; see [integration/commands.py](../../../integration/commands.py).
