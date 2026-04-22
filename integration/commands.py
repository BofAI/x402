"""Built-in commands for the x402 integration runner.

Register new commands with the @builtin decorator:

    @builtin("my_cmd", usage="@my_cmd <arg1> <arg2>")
    def my_cmd(args: list[str], workdir: str) -> tuple[int, str, str]:
        return (exit_code, stdout, stderr)

Pattern inspired by sun-protocol/apollo-arena; clean-room implementation.
"""

from __future__ import annotations

import json
import shlex
from pathlib import Path
from typing import Callable

_REGISTRY: dict[str, dict] = {}


def builtin(name: str, usage: str):
    def decorator(fn: Callable) -> Callable:
        _REGISTRY[name] = {"handler": fn, "usage": usage}
        return fn

    return decorator


def dispatch(command_line: str, workdir: str) -> tuple[int, str, str]:
    """Parse '@name args...' and invoke the registered handler."""
    parts = shlex.split(command_line)
    name = parts[0].lstrip("@")
    args = parts[1:]

    entry = _REGISTRY.get(name)
    if entry is None:
        available = ", ".join(sorted(_REGISTRY.keys()))
        return (2, "", f"unknown builtin '@{name}'. available: {available}")

    return entry["handler"](args, workdir)


def list_builtins() -> list[dict]:
    return [
        {"name": name, "usage": entry["usage"]}
        for name, entry in sorted(_REGISTRY.items())
    ]


# ---------------------------------------------------------------------------
# Built-ins
# ---------------------------------------------------------------------------


def _diff(a, b, path: str = "") -> list[tuple[str, str, str]]:
    """Recursively diff two JSON values. Returns (kind, path, detail) tuples."""
    out: list[tuple[str, str, str]] = []

    if isinstance(a, dict) and isinstance(b, dict):
        for key in sorted(set(a) | set(b)):
            child = f"{path}.{key}" if path else key
            if key not in a:
                out.append(("added", child, json.dumps(b[key])))
            elif key not in b:
                out.append(("removed", child, json.dumps(a[key])))
            else:
                out.extend(_diff(a[key], b[key], child))
    elif isinstance(a, list) and isinstance(b, list):
        for i in range(max(len(a), len(b))):
            child = f"{path}[{i}]"
            if i >= len(a):
                out.append(("added", child, json.dumps(b[i])))
            elif i >= len(b):
                out.append(("removed", child, json.dumps(a[i])))
            else:
                out.extend(_diff(a[i], b[i], child))
    elif a != b:
        out.append(("changed", path or "<root>", f"{json.dumps(a)} \u2192 {json.dumps(b)}"))

    return out


@builtin("json_diff", usage="@json_diff <actual> <expected>")
def json_diff(args: list[str], workdir: str) -> tuple[int, str, str]:
    """Compare two JSON files and produce field-level differences."""
    if len(args) != 2:
        return (2, "", "usage: @json_diff <actual> <expected>")

    base = Path(workdir)

    def _resolve(p: str) -> Path:
        path = Path(p)
        return path if path.is_absolute() else base / path

    try:
        actual = json.loads(_resolve(args[0]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return (2, "", f"failed to load actual '{args[0]}': {e}")

    try:
        expected = json.loads(_resolve(args[1]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return (2, "", f"failed to load expected '{args[1]}': {e}")

    diffs = _diff(actual, expected)
    if not diffs:
        return (0, "MATCH: files are identical", "")

    lines = [f"DIFF: {len(diffs)} difference(s)"]
    for kind, path, detail in diffs:
        lines.append(f"  [{kind}] {path}: {detail}")
    return (1, "\n".join(lines), "")
