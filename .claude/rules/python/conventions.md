# Python conventions (x402)

Target: **Python 3.11+**. Package: `bankofai-x402` (`src/bankofai/x402/`).

## Tooling

- **Deps**: `uv` (`uv sync --group dev`, `uv run pytest`). Do not commit `pip` artefacts.
- **Build**: `hatchling`. Do not switch build backends.
- **Tests**: `pytest` + `pytest-asyncio`. Test discovery and logging format are pinned in `pytest.ini` — do not relax.
- **Type check**: `mypy` (strict in CI). Keep the module green; don't `# type: ignore` without a comment explaining why.
- **Lint**: project does not yet enforce ruff/black via CI, but code should be formatted as if it did. Don't let whitespace churn dominate diffs.

## Structure

- Single namespace package under `src/bankofai/x402/`. One concept per subpackage (`mechanisms/`, `facilitator/`, `server/`, `clients/`).
- `types.py` + `schemas/` hold **protocol-shape** Pydantic models. Keep these 1:1 with the wire format.
- Never shadow stdlib names (`types`, `http`, `config`) outside of this package's own namespace.

## Idioms

- **Pydantic v2** — use `model_dump(mode="json")` for wire output; `model_validate` for input. Never `dict()`, never `parse_obj`.
- **Async-first client code**. Sync wrappers delegate via `asyncio.run` at the entry point; don't interleave blocking and async in library code.
- **HTTP**: `httpx.AsyncClient`. Configure with explicit timeouts; never rely on the default.
- **Logging**: module-level `logger = logging.getLogger(__name__)`. No `print` in library code. No `logging.basicConfig` — that's the application's call, not the library's.
- **Exceptions**: `X402Error` hierarchy in `exceptions.py`. Map facilitator error codes to specific subclasses; don't collapse them to a generic `FacilitatorError`.
- **BigInt equivalent**: Python `int` is arbitrary-precision. Never convert amounts through `float`, even briefly for formatting.

## Tests

- Mirror source tree: `tests/<subpackage>/test_<module>.py`.
- Mocks live in `tests/mocks/` — reuse before inventing.
- Async tests: `@pytest.mark.asyncio`, default loop `asyncio` (already set).
- When mocking HTTP, use `httpx.MockTransport`, not `respx` (the repo is `httpx`-native).

## Don'ts

- **Don't pin dependencies to exact versions** in `pyproject.toml` without a reason in the commit message.
- **Don't import across component boundaries** at module load time — i.e. `mechanisms/` must not import from `server/`. Shared helpers belong in `utils/`.
- **Don't catch bare `Exception` in the pay path.** Be specific; let unexpected errors surface.
