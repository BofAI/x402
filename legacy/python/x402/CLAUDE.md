# python/x402

Python SDK (`bankofai-x402`). Client + server (FastAPI/Flask) + facilitator bindings + on-chain mechanisms for EVM and TRON.

## Build & test

```bash
# from python/x402/
uv sync --group dev         # install deps
uv run pytest               # full unit suite (see pytest.ini)
uv run pytest tests/exact/  # single scheme
uv run pytest -k tron       # keyword match
uv run mypy src             # type check (strict in CI)
```

`pytest.ini` sets `addopts = -v --tb=short --log-cli-level=INFO`. Don't weaken these in committed code.

Python target: **3.11+** (see `pyproject.toml`).

## Layout

```
src/bankofai/x402/
├── clients/                # fetch-style HTTP client with payment auto-retry
├── server/                 # generic ASGI middleware
├── fastapi/, http/         # framework adapters
├── facilitator/            # verify + settle bindings
├── mechanisms/             # evm/, tron/, _exact_base, _exact_permit_base, _base
├── signers/                # account abstractions
├── schemas/, types.py      # protocol payloads (Pydantic)
├── utils/                  # address conversion, hex helpers, etc.
├── tokens/, address/       # registry + helpers
├── extensions/             # non-core extension payloads (legacy fallback etc.)
├── mcp/                    # MCP transport — currently stubbed
├── encoding.py             # Base64(UTF-8(JSON)) header codec
├── logging_config.py       # use `logging.getLogger(__name__)` everywhere
├── exceptions.py           # X402Error hierarchy — do not raise bare ValueError in the pay path
└── config.py               # network + contract registry
```

## Conventions

- **Signing path is security-reviewer territory.** Changes to `mechanisms/`, `signers/`, `facilitator/` should route through the `security-reviewer` subagent.
- **Addressing**: never pass TRON Base58 to EIP-712 / TIP-712. Use `utils.tron.to_hex_address` / `addressToHex`. See [.claude/rules/networks/tron.md](../../.claude/rules/networks/tron.md) and [docs/solutions.md entry #1](../../docs/solutions.md).
- **Money**: smallest unit only. `int` throughout; no floats in the pay path.
- **Async**: client paths are async-first (`httpx.AsyncClient`). Sync adapters live alongside but delegate.
- **Pydantic**: v2. Use `model_dump(mode="json")` for wire output; never `dict()`.
- **Logging**: module-level `logger = logging.getLogger(__name__)`. No `print` in library code.
- **Errors**: raise `X402Error` subclasses (see `exceptions.py`). Facilitator-returned errors map to specific subclasses — don't collapse them.

## Tests

- Scheme-specific: `tests/exact/`, `tests/exact/test_tron_client.py`, `test_tron_facilitator.py`
- Facilitator: `tests/facilitator/`
- Mocks: `tests/mocks/` — reuse, don't reinvent
- Mechanisms: `tests/unit/` for pure logic, `tests/integrations/` for end-to-end in-process

Smoke tests live outside this tree, in [`examples/bsc-testnet-smoke/`](../../examples/bsc-testnet-smoke/) and [`e2e/scenarios/`](../../e2e/scenarios/).

## Gotchas

Read [docs/solutions.md](../../docs/solutions.md) before investigating:
- GasFree deadline clamping (entry #2)
- Balance source for `SufficientBalancePolicy` (entry #3)
- TRON `raw_data_hex` preservation (commit `e6f4cb7`)
- `validAfter` + `validBefore` pre-check on server (commit `c9e53b8`)
