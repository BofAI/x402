# Testnet scenarios

These scenarios hit **real testnets** (BSC testnet, TRON Nile) and settle
**real on-chain transactions** through [`examples.facilitator`](../../../examples/facilitator/). They are the counterpart to the mock scenarios under [`../`](../) and the same test client + resource server code drives both.

| Scenario | Network | Scheme | Settlement |
|---|---|---|---|
| [`exact_testnet/`](exact_testnet/) | `eip155:97` (BSC testnet) | `exact` (ERC-3009) | single tx (transferWithAuthorization) |
| [`exact_permit_testnet/`](exact_permit_testnet/) | `eip155:97` | `exact_permit` (EIP-2612) | permit + transferFrom |
| [`exact_gasfree_testnet/`](exact_gasfree_testnet/) | `tron:nile` | `exact_gasfree` (TIP-712) | GasFree relayer submits |

## Current status

| Scenario | Status | Evidence |
|---|---|---|
| `exact_testnet` | ✅ verified 2026-04-24 | BSC Testnet DHLU transfer, tx `461d17baae60b83031de55bb1635bd5f8453d359887e7e82ebee605ab6c159a0` · ~6 s pay + ~4 s teardown |
| `exact_permit_testnet` | ✅ verified 2026-04-24 | BSC Testnet USDT permit + transferFrom, tx `0xfc8b32decb99d02cdfc684d3f6f1c7c0a91c8b0ff1f632f98d86d9f334198a23` (block 103475005) · requires `FACILITATOR_BASE_FEE` env (see [solutions.md #7](../../../docs/solutions.md)) |
| `exact_gasfree_testnet` | ✅ verified 2026-04-24 | TRON Nile USDT via GasFree relayer, tx `1d77f242b72293116e65c46b5ad756dd2f8355ebc625078aec0eb4ea54d148d2` (12s pay including relayer submit). Requires funded `gasFreeAddress` — see [solutions.md #9](../../../docs/solutions.md). |

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

## Gotchas

- **`${VAR:-default}` does NOT work** in `config.json` commands — the integration runner uses `os.path.expandvars` which doesn't recognize shell default-value syntax. Use plain `${VAR}` only, and guard required vars in `run_testnet.sh`. See [solutions.md #8](../../../docs/solutions.md).
- **`FACILITATOR_BASE_FEE` is required** for `exact_permit` + `exact_gasfree`. Without it every token is reported as "Unsupported" and the resource server returns HTTP 404. Value is JSON: `{"USDT": 1000, "USDC": 1000, "DHLU": 1000}` (smallest unit; 1000 at decimals=6 = 0.001 token). See [solutions.md #7](../../../docs/solutions.md).
- **GasFree custodial wallet ≠ main wallet.** The payer's USDT must sit in the GasFree custodial address derived from the client key — not in the visible TRON main wallet. See [solutions.md #3](../../../docs/solutions.md).
- **Tx hash format is chain-dependent.** BSC returns bare 64-hex; TRON sometimes includes `0x`. Use regex `^(0x)?[0-9a-fA-F]{64}$` in `@json_match` for `payment_response.transaction`.
- **Failed-step reports** land in `/tmp/x402-e2e-<scenario>.md`; process logs in `/tmp/x402-e2e-pids/*.log`; client response JSON in `/tmp/x402-e2e-<scenario>-response.json`.

## Why not just reuse `@json_diff`?

Real on-chain transactions return a fresh tx hash every run, so strict
equality against a committed `expected_payment_response.json` would fail.
`@json_match` supports both exact literal matches (for status codes,
booleans, network IDs) and regex matches (for dynamic fields like tx
hashes). It's intentionally simple; see [integration/commands.py](../../../integration/commands.py).
