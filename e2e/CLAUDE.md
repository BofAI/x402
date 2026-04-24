# e2e/

End-to-end scenarios. **Two tiers, same test client + resource server — only the facilitator and assertion style differ.**

- **Mock tier** (default, runs on every PR): no network, no credentials, runs in ~30s. Wired in `.github/workflows/check_e2e.yml`.
- **Testnet tier** (nightly): real BSC testnet + TRON Nile settlement through [`examples/facilitator/`](../examples/facilitator/). Scenarios self-skip when their secrets are blank.

## Run

```bash
# mock suite (no creds)
./e2e/scenarios/run_all.sh

# testnet (requires .env — see .env.example)
./e2e/scenarios/run_testnet.sh

# single scenario
python3 integration/run.py --config e2e/scenarios/<name>/config.json
```

## Layout

```
clients/test_client.py          — real-signature EVM + TRON client
servers/resource_server.py      — FastAPI + @x402_protected
mock_facilitator/app.py         — dual role: facilitator + GasFree API (mode-driven)
scenarios/
├── <name>/                     — one scenario per directory
│   ├── config.json             — integration/run.py step list
│   ├── expected_*.json         — diff-asserted response(s)
│   └── (scenario_*.json)       — mock-chainrpc scenario, when applicable
├── testnet/                    — real-chain scenarios, gated by .env
├── run_all.sh / run_testnet.sh — CI entry points
└── README.md                   — scenario catalog
```

## Scenario conventions

See [.claude/rules/testing/scenarios.md](../.claude/rules/testing/scenarios.md). Summary:

- **One directory per scenario, JSON-only config.** No Python scenarios.
- **Ports**: mock facilitator `4020`, resource server `4021`. Pick disjoint ports (`4022`, `4023`, ...) if you need more than one of each in a scenario.
- **`E2E_*` env vars** are the contract between the config runner and the server/client — see `servers/resource_server.py` for the full list. Don't invent new ones without updating both sides.
- **Failure modes**: `mock_facilitator` supports `--mode {success, fail_verify_invalid_sig, fail_verify_expired, fail_verify_network_mismatch, fail_settle_insufficient, fail_settle_revert}` (authoritative set in `mock_facilitator/app.py` as `_VALID_MODES`). Cover new failure modes by extending the mode enum, not by adding bespoke endpoints.
- **Diff assertion**: use `@json_diff` built-in from `integration/commands.py`. Don't write custom assertions in shell.

## Adding a scenario

Use the wizard:

```
/x402:create-scenario
```

It generates the directory skeleton and suggests follow-ups (index update, CI wiring).

## Gotchas

- **`raw_data_hex`** on TRON approvals — don't recompute, preserve as-is from the signer.
- **Unhappy tests must assert HTTP 500** from the resource server (not 402) — the retry already happened; failure here is a settle/verify error bubbling up.
- **Mock facilitator mode** is process-wide — start a fresh mock instance per scenario rather than switching modes mid-run.
