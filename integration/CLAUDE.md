# integration

Generic integration step runner (Python 3). Read [README.md](README.md) for full CLI reference.

## Architecture

```
run.py          CLI entry, step executor, Markdown report writer
commands.py     @-builtin command registry + implementations
configs/        example configs (including smoke.json self-test)
```

No external Python deps. Targets 3.9+.

## Conventions

- **One responsibility per file**: new built-ins go in `commands.py`; do not create per-command files unless a single command grows past ~100 lines.
- **Error exit codes**: `0` success, `1` test failure, `2` harness or config error. Treat these as contract; CI scripts depend on this.
- **No mutation of inputs**: `run_step` and `format_report` are pure; state flows through return values, not shared lists.

## Extending

Add a built-in:

```python
@builtin("curl_json", usage="@curl_json <url> <output-path>")
def curl_json(args, workdir):
    ...
    return (exit_code, stdout, stderr)
```

The `@builtin` decorator registers with the dispatcher; `--list-builtins` will show it automatically.

## Used by

- [e2e/scenarios/](../e2e/scenarios/) — declarative scenario tests
- Future CI workflows under `.github/workflows/`

## Non-goals

- Parallel step execution. Scenarios are intentionally sequential for determinism.
- Matrix / combinatorial testing. That belongs in a separate harness (e.g. Coinbase-style `e2e/test.ts`), not in this runner.
