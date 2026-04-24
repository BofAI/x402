# integration

Generic integration step runner used by `e2e/scenarios/`. Reads a JSON config, executes shell commands or `@`-prefixed built-ins sequentially (fail-fast), and writes a Markdown report.

## Usage

```bash
# Run a scenario
python3 integration/run.py --config e2e/scenarios/exact_permit_happy_path/config.json

# Override report path
python3 integration/run.py --config path/to/config.json --report /tmp/report.md

# List built-ins
python3 integration/run.py --list-builtins
```

Exit codes: `0` all passed · `1` step failed · `2` config/env error.

## Config format

```json
{
  "name": "suite name",
  "report": "path/to/report.md",
  "steps": [
    {
      "name": "step description",
      "command": "shell command or @builtin args",
      "workdir": ".",
      "timeout": 30
    }
  ]
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `name` | string | config filename stem | Suite name in report |
| `report` | string | none (stdout only) | Markdown report output path |
| `steps[].name` | string | `step N` | Step display name |
| `steps[].command` | string | **required** | Shell command, or `@`-prefix for builtin |
| `steps[].workdir` | string | repo root | Relative paths resolve from repo root |
| `steps[].timeout` | number | 30 | Seconds |

## Command types

### Shell

No `@` prefix. Executed via `subprocess.run(shell=True)`.

```json
{ "command": "pnpm -C typescript/packages/x402 build" }
```

### Built-in

`@` prefix. Dispatched to handlers in `commands.py`.

| Command | Usage | Purpose |
|---|---|---|
| `@json_diff` | `@json_diff <actual> <expected>` | Deep JSON diff with field-level output. Exit 0 identical, 1 diff, 2 file error. |

## Execution

- **Fail-fast**: the runner stops at the first failed step; remaining steps are marked skipped in the report.
- **Path resolution**: `workdir` resolves from the repo root. `@json_diff` file paths resolve from the step's `workdir`.

## Extending

Add a new built-in in `commands.py`:

```python
@builtin("my_cmd", usage="@my_cmd <arg1> <arg2>")
def my_cmd(args: list[str], workdir: str) -> tuple[int, str, str]:
    return (0, "ok", "")
```

## Smoke check

A minimal self-test (no x402 dependencies) is in `integration/configs/smoke.json`:

```bash
python3 integration/run.py --config integration/configs/smoke.json
```

Expect `✓` on both steps and exit 0.
