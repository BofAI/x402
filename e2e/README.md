# e2e

End-to-end scenarios that exercise the full x402 payment flow against a local mock facilitator. No external network required.

## Layout

```
e2e/
├── clients/              # test client that drives a real signed payment flow
│   └── test_client.py
├── servers/              # FastAPI resource server with @x402_protected
│   └── resource_server.py
├── mock_facilitator/     # mode-driven facilitator stub
│   ├── app.py
│   └── __main__.py
└── scenarios/            # declarative scenario configs (see scenarios/README.md)
    ├── exact_happy_path/
    ├── exact_permit_happy_path/
    ├── unhappy_verify_invalid_sig/
    └── unhappy_settle_insufficient/
```

## Run

```bash
./e2e/scenarios/run_all.sh           # all scenarios
python3 -m integration.run --config e2e/scenarios/exact_happy_path/config.json
```

See [scenarios/README.md](scenarios/README.md) for the full matrix, architecture diagram, and guide for adding new scenarios.

## CI

Wired up in [`.github/workflows/check_e2e.yml`](../.github/workflows/check_e2e.yml) — runs on every PR.

## Why this harness exists

Unit tests in `python/x402/tests/` cover individual components (mechanisms, facilitator client, signers) in isolation. The e2e scenarios cover the wire flow across all three roles — the HTTP 402 challenge-response, header encoding, scheme selection, retry semantics, and error propagation from facilitator → server → client. That interaction is where the interesting bugs hide.

The facilitator is mocked (not a real chain) so scenarios stay deterministic, fast, and runnable on CI without funded accounts. For live-chain smoke tests, see [`examples/bsc-testnet-smoke/`](../examples/bsc-testnet-smoke/).
