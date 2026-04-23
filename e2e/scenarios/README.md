# e2e scenarios

Declarative end-to-end tests that exercise the full x402 payment flow
(Client → Server → Facilitator) against a local mock facilitator. Each
scenario is a single `config.json` consumed by [`integration/run.py`](../../integration/run.py).

## Architecture

```
┌─ test client ────┐  ┌─ resource server ──┐  ┌─ mock facilitator ─┐
│ e2e/clients/     │─▶│ e2e/servers/       │─▶│ e2e/mock_facil...  │
│ test_client.py   │  │ resource_server.py │  │                    │
│ signs real       │  │ 402 + x402 decor.  │  │ mode-driven        │
│ EIP-712 payloads │◀─│                    │◀─│ verify/settle      │
└──────────────────┘  └────────────────────┘  └────────────────────┘
```

- **Live signing, mock verify**: the client signs real payloads; the facilitator does not verify them, it just echoes success/failure based on its mode.
- **Deterministic tx hash**: the mock returns `0x` + `"11"` × 32 on success.
- **No chain RPC**: `E2E_SKIP_ALLOWANCE=1` bypasses the `exact_permit` on-chain allowance check, and `E2E_SKIP_TX_VERIFICATION=1` monkey-patches the post-settle tx verifier so the TRON `exact_gasfree` scenario doesn't try to look up the fake tx hash on a live node. Both exist because the mock facilitator does not verify either — without them the scenario would need a funded testnet account and a reachable RPC.
- **GasFree API**: the mock facilitator also serves `/api/v1/address/{user}` and `/api/v1/config/provider/all` on the same port, so one `@start_bg` covers both facilitator and GasFree roles.

## Scenarios

| Directory | What it covers | Mode |
|---|---|---|
| [`exact_happy_path/`](exact_happy_path/) | ERC-3009 `exact` on BSC testnet, single scheme | `success` |
| [`exact_permit_happy_path/`](exact_permit_happy_path/) | EIP-2612 `exact_permit` on BSC testnet, allowance skipped | `success` |
| [`exact_gasfree_happy_path/`](exact_gasfree_happy_path/) | TIP-712 `exact_gasfree` on TRON Nile, GasFree API mocked, tx verification skipped | `success` |
| [`unhappy_verify_invalid_sig/`](unhappy_verify_invalid_sig/) | Signature rejected by facilitator | `fail_verify_invalid_sig` |
| [`unhappy_verify_expired/`](unhappy_verify_expired/) | Authorization expired before settle | `fail_verify_expired` |
| [`unhappy_verify_network_mismatch/`](unhappy_verify_network_mismatch/) | Payload's network doesn't match facilitator's | `fail_verify_network_mismatch` |
| [`unhappy_settle_insufficient/`](unhappy_settle_insufficient/) | Payer balance insufficient | `fail_settle_insufficient` |
| [`unhappy_settle_revert/`](unhappy_settle_revert/) | On-chain settlement reverts | `fail_settle_revert` |

## Running one scenario

```bash
cd /Users/bobo/code/x402/x402
python3 -m integration.run --config e2e/scenarios/exact_happy_path/config.json
```

Exit codes: `0` pass, `1` scenario failure, `2` harness/config error.

## Running all scenarios

```bash
./e2e/scenarios/run_all.sh
```

This is also what `.github/workflows/check_e2e.yml` runs.

## Adding a new scenario

1. Create `e2e/scenarios/<name>/config.json` with the standard seven-step shape: start facilitator → wait → start server → wait → run client → `@json_diff` → `@stop_all_bg`.
2. Capture the actual client output once (`cat /tmp/x402-e2e-*-response.json`), write it to `expected_payment_response.json`.
3. Add the row to the table above.

## Mock facilitator modes

| Mode | `/verify` | `/settle` |
|---|---|---|
| `success` | `{isValid: true}` | success + deterministic tx |
| `fail_verify_invalid_sig` | `{isValid: false, invalidReason: "invalid_signature"}` | fails with `errorReason: "invalid_signature"` |
| `fail_verify_expired` | `{isValid: false, invalidReason: "deadline_expired"}` | fails with `errorReason: "deadline_expired"` |
| `fail_verify_network_mismatch` | `{isValid: false, invalidReason: "network_mismatch"}` | fails with `errorReason: "network_mismatch"` |
| `fail_settle_insufficient` | ok | fails with `errorReason: "insufficient_balance"` |
| `fail_settle_revert` | ok | fails with `errorReason: "settle_reverted"` |

Note: the x402 server skips `/verify` and calls `/settle` directly (the facilitator verifies internally). `fail_verify_*` modes therefore surface via `/settle` errors — that is intentional and mirrors how real facilitators deliver verify failures post-submit.
