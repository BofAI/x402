# e2e

End-to-end scenarios that exercise the full x402 payment flow. Two tiers:

- **Mock tier** — default on every PR. No external network. Runs in ~30s.
- **Testnet tier** — opt-in via `.env`, nightly in CI. Real on-chain settlement on BSC testnet / TRON Nile through [`examples.facilitator`](../examples/facilitator/).

Same test client and resource server drive both tiers — only the facilitator and assertion style differ.

## Layout

```
e2e/
├── clients/              # test client (real signatures; EVM + TRON)
│   └── test_client.py
├── servers/              # FastAPI resource server with @x402_protected
│   └── resource_server.py
├── mock_facilitator/     # mode-driven stub (dual-role: facilitator + GasFree API)
│   ├── app.py
│   └── __main__.py
└── scenarios/
    ├── exact_happy_path/          # mock: happy path
    ├── exact_permit_happy_path/
    ├── exact_gasfree_happy_path/
    ├── unhappy_*/                 # mock: 5 failure modes
    ├── run_all.sh                 # runs the mock suite (CI)
    ├── run_testnet.sh             # runs the testnet suite (nightly)
    └── testnet/                   # real-chain scenarios (see testnet/README.md)
        ├── exact_testnet/
        ├── exact_permit_testnet/
        └── exact_gasfree_testnet/
```

## Run

```bash
# mock suite (default — no credentials needed)
./e2e/scenarios/run_all.sh

# testnet suite (requires .env — skips scenarios with blank secrets)
set -a; source .env; set +a
./e2e/scenarios/run_testnet.sh
```

See [scenarios/README.md](scenarios/README.md) and [scenarios/testnet/README.md](scenarios/testnet/README.md) for per-tier details.

## CI

- [`check_e2e.yml`](../.github/workflows/check_e2e.yml) — mock suite, every PR.
- [`nightly_testnet.yml`](../.github/workflows/nightly_testnet.yml) — testnet suite, nightly + `workflow_dispatch`. Pulls secrets from GitHub Environments.

## Why two tiers

Mock scenarios stay deterministic, fast, and 100% offline so every PR can afford to run all 8. Testnet scenarios prove the same code paths actually settle on real chains, but need funded accounts and testnet RPCs that are too slow/flaky/costly for per-PR gating.

Unit tests in `python/x402/tests/` cover individual components in isolation; the e2e scenarios cover the wire flow across all three roles (client ↔ server ↔ facilitator), which is where interop bugs hide.
