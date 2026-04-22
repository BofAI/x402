# Scenario: exact_permit_happy_path

**Scheme**: `exact_permit` · **Network**: `eip155:97` (BSC Testnet)

Canonical template showing the declarative scenario layout. Exercises a single-request payment flow end-to-end:

```
client → GET /protected  → 402 (PaymentRequired)
client → GET /protected with PAYMENT-SIGNATURE (permit-signed payload)
server → facilitator.verify + settle
server → 200 OK + PAYMENT-RESPONSE
```

## Status

**Template.** `config.json` references servers / facilitator binaries not yet wired into CI. Use this directory as the starting point for a runnable scenario once the prerequisites below are in place.

## Prerequisites (to make this runnable)

| Prereq | Status |
|---|---|
| Facilitator binary with `--mock` mode | not yet (P2 in [ai-transformation](../../../docs/design/ai-transformation.md)) |
| Resource server with `exact_permit` mechanism on BSC testnet | exists: `examples/bsc-testnet-smoke/bsc_exact_client.py` – adapt |
| Signed payment payload fixture | TODO — generate from a deterministic test key |
| Expected `PAYMENT-RESPONSE` JSON | `expected_payment_response.json` (stub) |

## Run

Once the prerequisites above are met:

```bash
python3 integration/run.py --config e2e/scenarios/exact_permit_happy_path/config.json
```

Report will be written to `/tmp/x402-e2e-exact-permit-happy.md`.

## Files

| File | Purpose |
|---|---|
| [config.json](config.json) | Step runner config |
| [expected_payment_response.json](expected_payment_response.json) | Expected `PAYMENT-RESPONSE` after settlement |

## How to adapt for a different scheme

Copy this directory, then:

1. Replace scheme / network in this README header.
2. Update `config.json` step commands (facilitator / server flags).
3. Regenerate `expected_*.json` from a known-good live run.
4. Cross-reference from `e2e/scenarios/README.md` (once that index exists).

Or: run `/x402:create-scenario` for a wizard-guided scaffold.
