# examples/

Smoke tests and reference integrations. **Not** unit tests — these are real-network validators and the canonical facilitator implementation.

## Layout

| Dir | Purpose |
|---|---|
| [bsc-testnet-smoke/](bsc-testnet-smoke/) | Bidirectional BSC Testnet `exact` + `exact_permit` smoke. Canonical proof of Coinbase v2 interop (2026-04-03). |
| [facilitator/](facilitator/) | Reference facilitator implementation (Python) used by the testnet e2e tier. |

## Run

Each dir has its own README with the run recipe. All require `.env` credentials — see [`.env.example`](../.env.example).

## Rules

- **Examples are real-network.** Never commit private keys, pay-to addresses tied to live balances, or RPC URLs with API keys. Use `.env` + `.env.example`.
- **Do not refactor examples for DRY with `python/` or `typescript/`.** They are intentionally standalone so a developer can read one directory and run it — duplication is cheaper than import graphs across components.
- **`facilitator/` is a reference implementation, not a drop-in package.** Treat changes here as protocol-impacting; route signing / settlement changes through the `security-reviewer` subagent.
