"""Built-in commands for the x402 integration runner.

Register new commands with the @builtin decorator:

    @builtin("my_cmd", usage="@my_cmd <arg1> <arg2>")
    def my_cmd(args: list[str], workdir: str) -> tuple[int, str, str]:
        return (exit_code, stdout, stderr)

Pattern inspired by sun-protocol/apollo-arena; clean-room implementation.
"""

from __future__ import annotations

import json
import os
import shlex
import signal
import subprocess
import time
import urllib.error
import urllib.request
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


# ---------------------------------------------------------------------------
# Service lifecycle (for scenarios that spin up a mock facilitator + server)
# ---------------------------------------------------------------------------

_PID_DIR = Path(os.environ.get("X402_E2E_PID_DIR", "/tmp/x402-e2e-pids"))


def _pid_file(tag: str) -> Path:
    _PID_DIR.mkdir(parents=True, exist_ok=True)
    return _PID_DIR / f"{tag}.pid"


def _log_file(tag: str) -> Path:
    _PID_DIR.mkdir(parents=True, exist_ok=True)
    return _PID_DIR / f"{tag}.log"


@builtin(
    "start_bg",
    usage="@start_bg <tag> <shell-command...>",
)
def start_bg(args: list[str], workdir: str) -> tuple[int, str, str]:
    if len(args) < 2:
        return (2, "", "usage: @start_bg <tag> <shell-command...>")
    tag = args[0]
    command = " ".join(shlex.quote(a) for a in args[1:])

    pid_file = _pid_file(tag)
    if pid_file.exists():
        try:
            old_pid = int(pid_file.read_text().strip())
            os.kill(old_pid, signal.SIGTERM)
        except (OSError, ValueError):
            pass
        pid_file.unlink(missing_ok=True)

    log_path = _log_file(tag)
    log_fd = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        command,
        shell=True,
        cwd=workdir,
        stdout=log_fd,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    pid_file.write_text(str(proc.pid))
    return (
        0,
        f"started tag={tag} pid={proc.pid} log={log_path}",
        "",
    )


@builtin(
    "wait_http",
    usage="@wait_http <url> [timeout_seconds=20] [expected_status=any]",
)
def wait_http(args: list[str], workdir: str) -> tuple[int, str, str]:
    if not args:
        return (2, "", "usage: @wait_http <url> [timeout_seconds] [expected_status]")
    url = args[0]
    timeout = float(args[1]) if len(args) >= 2 else 20.0
    expected_status_raw = args[2] if len(args) >= 3 else "any"

    deadline = time.monotonic() + timeout
    last_error = "no attempts"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                status = resp.getcode()
                if expected_status_raw == "any" or status == int(expected_status_raw):
                    return (0, f"ready: {url} -> HTTP {status}", "")
                last_error = f"HTTP {status}"
        except urllib.error.HTTPError as exc:
            if expected_status_raw != "any" and exc.code == int(expected_status_raw):
                return (0, f"ready: {url} -> HTTP {exc.code}", "")
            last_error = f"HTTP {exc.code}"
        except urllib.error.URLError as exc:
            last_error = f"URLError: {exc.reason}"
        except OSError as exc:
            last_error = f"OSError: {exc}"
        time.sleep(0.25)

    return (1, "", f"timeout waiting for {url}: last={last_error}")


@builtin("stop_bg", usage="@stop_bg <tag>")
def stop_bg(args: list[str], workdir: str) -> tuple[int, str, str]:
    if len(args) != 1:
        return (2, "", "usage: @stop_bg <tag>")
    tag = args[0]
    pid_file = _pid_file(tag)
    if not pid_file.exists():
        return (0, f"no pid file for tag={tag}, nothing to stop", "")

    try:
        pid = int(pid_file.read_text().strip())
    except (OSError, ValueError) as exc:
        return (1, "", f"failed to read pid: {exc}")

    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except ProcessLookupError:
        pid_file.unlink(missing_ok=True)
        return (0, f"tag={tag} pid={pid} already gone", "")
    except OSError as exc:
        return (1, "", f"killpg failed for pid={pid}: {exc}")

    for _ in range(20):
        try:
            os.kill(pid, 0)
            time.sleep(0.1)
        except ProcessLookupError:
            break
    else:
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except OSError:
            pass

    pid_file.unlink(missing_ok=True)
    return (0, f"stopped tag={tag} pid={pid}", "")


@builtin(
    "stop_all_bg",
    usage="@stop_all_bg  (terminates every background service this runner knows about)",
)
def stop_all_bg(args: list[str], workdir: str) -> tuple[int, str, str]:
    if args:
        return (2, "", "usage: @stop_all_bg")
    if not _PID_DIR.exists():
        return (0, "no background services", "")
    stopped: list[str] = []
    for pid_file in sorted(_PID_DIR.glob("*.pid")):
        tag = pid_file.stem
        result = stop_bg([tag], workdir)
        stopped.append(f"{tag}: {result[1] or result[2]}")
    return (0, "\n".join(stopped) if stopped else "no background services", "")
