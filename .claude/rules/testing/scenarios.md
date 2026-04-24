# Testing: scenarios & e2e

Conventions for scenario-style e2e tests under [`e2e/scenarios/`](../../../e2e/scenarios/), driven by [`integration/run.py`](../../../integration/run.py).

## Philosophy

- **Declarative JSON, no scenario code.** A scenario is `config.json` + `expected_*.json` + optional `scenario_*.json` (mock-chainrpc). The scenario runner is generic; tests stay readable and add-new is a copy-paste.
- **Diff, don't script.** Use `@json_diff` from `integration/commands.py`. Ordering of JSON keys must not matter — the diff normalizes.
- **Self-contained.** Every scenario starts its own mock facilitator + resource server, on its own ports. A scenario that assumes "the previous scenario left X running" is broken.

## File conventions

Under `e2e/scenarios/<name>/`:

| File | Required | Purpose |
|---|---|---|
| `config.json` | yes | Steps for `integration/run.py` |
| `expected_<label>.json` | yes (per diff step) | Expected response payload |
| `scenario_<label>.json` | when using mock-chainrpc | Chain-state snapshot |
| `README.md` | yes | Purpose, preconditions, run command |

Name the scenario dir `<scheme>_<chain|tier>_<outcome>`: `exact_happy_path`, `exact_permit_happy_path`, `exact_gasfree_happy_path`, `unhappy_verify_invalid_sig`, `unhappy_settle_revert`.

## Port allocation

Conventional ports (keep disjoint across parallel scenarios if you add CI parallelism later):

| Service | Port |
|---|---|
| mock-facilitator | 4020 |
| resource-server | 4021 |
| (additional)    | 4022, 4023, … |

## Env contract

Resource server reads `E2E_*` vars (`E2E_NETWORK`, `E2E_SCHEMES`, `E2E_SERVER_PORT`, `E2E_ASSET_PRICE`, …). See `servers/resource_server.py` for the canonical list. Do not invent new `E2E_*` vars without updating the server too.

## Failure modes

`mock_facilitator` takes `--mode`. Currently supports: `success`, `fail_verify_invalid_sig`, `fail_verify_expired`, `fail_verify_network_mismatch`, `fail_settle_insufficient`, `fail_settle_revert` (authoritative set is `_VALID_MODES` in `mock_facilitator/app.py`). Extend the enum there rather than adding bespoke endpoints.

Unhappy tests assert **HTTP 500** from the resource server (because the retry attempt failed at verify/settle), never HTTP 402.

## Tiers

- **Mock tier** (`run_all.sh`) — runs in CI on every PR. Must pass with no secrets, no network.
- **Testnet tier** (`run_testnet.sh`) — nightly, real on-chain. Scenarios self-skip when their `.env` vars are blank. Do not gate PR CI on testnet.

## Adding a scenario

```
/x402:create-scenario
```

Manual skeleton:

```bash
mkdir e2e/scenarios/<name>
cp e2e/scenarios/exact_happy_path/config.json e2e/scenarios/<name>/
cp e2e/scenarios/exact_happy_path/expected_payment_response.json e2e/scenarios/<name>/
# edit, add README.md
python3 integration/run.py --config e2e/scenarios/<name>/config.json
```

## Don'ts

- **No shelling out to `pytest` from a scenario.** Scenarios are one layer above unit tests; keep unit tests in `python/x402/tests/` and `typescript/**/vitest`.
- **No sleeps longer than ~1s.** Use `@wait_http` or `@wait_tcp` built-ins to poll readiness.
- **No hardcoded absolute paths** in `config.json`. Everything relative to the repo root (the runner's default `workdir`).
- **Don't modify `integration/run.py` to fit a scenario.** The step runner is generic; if a scenario needs a new primitive, add a `@builtin` in `integration/commands.py`.
